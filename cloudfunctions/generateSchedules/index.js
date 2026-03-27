const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_NORMAL = 0;
const SHIFT_TYPE_LEAVE = 1;
const SHIFT_TYPE_SWAP = 2;
const SHIFT_TYPE_BORROW = 3;
const ATTENDANCE_ABSENT = 3;

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function formatDate(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function parseDateString(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
  if (!match) {
    return null;
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toChinaDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const offsetMinutes = 8 * 60 + date.getTimezoneOffset();
  return new Date(date.getTime() + offsetMinutes * 60 * 1000);
}

function formatChinaDate(input = new Date()) {
  const chinaDate = toChinaDate(input);
  return `${chinaDate.getUTCFullYear()}-${padNumber(chinaDate.getUTCMonth() + 1)}-${padNumber(chinaDate.getUTCDate())}`;
}

function sanitizePreferences(preferences) {
  const preferenceMap = {};

  if (!Array.isArray(preferences)) {
    return [];
  }

  preferences.forEach((item) => {
    const shiftId = String((item && item.shiftId) || '').trim();
    const dayOfWeek = Number(item && item.dayOfWeek);

    if (!shiftId || Number.isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return;
    }

    preferenceMap[`${shiftId}::${dayOfWeek}`] = { shiftId, dayOfWeek };
  });

  return Object.values(preferenceMap);
}

async function loadAllDocuments(collection, filter) {
  const documents = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const result = await collection.where(filter).skip(offset).limit(pageSize).get();
    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
}

function buildScheduleSlotKey(schedule) {
  return `${schedule.date}::${schedule.startTime}::${schedule.endTime}`;
}

function buildTemplateKey(date, shiftId) {
  return `${date}::${shiftId}`;
}

function shouldPreserveSchedule(schedule, regenerateFromDate) {
  if (!schedule || !schedule.date) {
    return true;
  }

  if (schedule.date < regenerateFromDate) {
    return true;
  }

  if (schedule.checkInTime || schedule.checkOutTime) {
    return true;
  }

  if (schedule.attendanceStatus === ATTENDANCE_ABSENT) {
    return true;
  }

  if (
    schedule.shiftType === SHIFT_TYPE_LEAVE ||
    schedule.shiftType === SHIFT_TYPE_SWAP ||
    schedule.shiftType === SHIFT_TYPE_BORROW
  ) {
    return true;
  }

  return false;
}

function createScheduleRecord({ semesterId, userId, userName, date, dayOfWeek, template }) {
  return {
    semesterId,
    userId,
    userName,
    date,
    dayOfWeek,
    shiftId: template._id,
    shiftName: template.name,
    startTime: template.startTime,
    endTime: template.endTime,
    fixedHours: Number(template.fixedHours) || 0,
    shiftType: SHIFT_TYPE_NORMAL,
    checkInTime: null,
    checkOutTime: null,
    attendanceStatus: null,
    overtimeHours: 0,
    overtimeApproved: false,
    leaveReason: '',
    leaveStatus: null,
    leaveApprovedBy: null,
    leaveApprovedAt: null,
    originalUserId: null,
    leaderConfirmStatus: null,
    leaderConfirmedAt: null,
    leaderConfirmedBy: null,
    leaderConfirmedByName: '',
    salaryPaid: false,
    salaryWeek: null,
    salaryAmount: null,
    salaryPaidAt: null,
    salaryPaidBy: null,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };
}

exports.main = async (event) => {
  const semesterId = String(event.semesterId || '').trim();
  const userId = String(event.userId || '').trim();
  const userName = String(event.userName || '').trim();

  if (!semesterId || !userId) {
    return { success: false, error: '参数错误' };
  }

  try {
    const schedulesCollection = db.collection('schedules');
    const semesterResult = await db.collection('semesters').doc(semesterId).get();
    const semester = semesterResult.data;

    if (!semester) {
      return { success: false, error: '学期不存在' };
    }

    if (semester.status !== 'active') {
      return { success: false, error: '当前学期未开放' };
    }

    const semesterStart = parseDateString(semester.startDate);
    const semesterEnd = parseDateString(semester.endDate);

    if (!semesterStart || !semesterEnd || semesterStart > semesterEnd) {
      return { success: false, error: '学期日期配置异常' };
    }

    const selectionResult = await db.collection('weeklySelections')
      .where({ semesterId, userId })
      .limit(1)
      .get();
    const selection = selectionResult.data && selectionResult.data[0] ? selectionResult.data[0] : null;
    const preferences = sanitizePreferences(selection ? selection.preferences : []);

    const templateList = await loadAllDocuments(db.collection('shiftTemplates'), { semesterId });
    const templateMap = {};
    templateList.forEach((template) => {
      templateMap[template._id] = template;
    });

    const allSchedules = await loadAllDocuments(schedulesCollection, { semesterId, userId });
    const regenerateFromDate = semester.startDate > formatChinaDate() ? semester.startDate : formatChinaDate();

    const preservedSchedules = [];
    const removableSchedules = [];

    allSchedules.forEach((schedule) => {
      if (shouldPreserveSchedule(schedule, regenerateFromDate)) {
        preservedSchedules.push(schedule);
      } else {
        removableSchedules.push(schedule);
      }
    });

    for (const schedule of removableSchedules) {
      await schedulesCollection.doc(schedule._id).remove();
    }

    if (preferences.length === 0) {
      return {
        success: true,
        message: '未配置班次偏好，已清理未来普通班次',
        removedCount: removableSchedules.length,
        createdCount: 0,
        preservedCount: preservedSchedules.length,
      };
    }

    const preservedSlotKeys = new Set();
    const preservedTemplateKeys = new Set();

    preservedSchedules.forEach((schedule) => {
      preservedSlotKeys.add(buildScheduleSlotKey(schedule));
      if (schedule.shiftId) {
        preservedTemplateKeys.add(buildTemplateKey(schedule.date, schedule.shiftId));
      }
    });

    const schedulesToCreate = [];
    const currentDate = parseDateString(regenerateFromDate);

    while (currentDate && currentDate <= semesterEnd) {
      const date = formatDate(currentDate);
      const day = currentDate.getDay();
      const dayOfWeek = day === 0 ? 6 : day - 1;

      preferences
        .filter((item) => item.dayOfWeek === dayOfWeek)
        .forEach((item) => {
          const template = templateMap[item.shiftId];
          if (!template) {
            return;
          }

          const slotKey = `${date}::${template.startTime}::${template.endTime}`;
          const templateKey = buildTemplateKey(date, template._id);

          if (preservedSlotKeys.has(slotKey) || preservedTemplateKeys.has(templateKey)) {
            return;
          }

          schedulesToCreate.push(createScheduleRecord({
            semesterId,
            userId,
            userName,
            date,
            dayOfWeek,
            template,
          }));
        });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    const batchSize = 20;
    for (let index = 0; index < schedulesToCreate.length; index += batchSize) {
      const batch = schedulesToCreate.slice(index, index + batchSize);
      await Promise.all(batch.map((schedule) => schedulesCollection.add({ data: schedule })));
    }

    return {
      success: true,
      message: `已生成 ${schedulesToCreate.length} 条班次`,
      removedCount: removableSchedules.length,
      createdCount: schedulesToCreate.length,
      preservedCount: preservedSchedules.length,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
