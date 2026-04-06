const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_NORMAL = 0;
const SHIFT_TYPE_LEAVE = 1;
const SHIFT_TYPE_SWAP = 2;
const SHIFT_TYPE_BORROW = 3;
const ATTENDANCE_ABSENT = 3;

function buildSelectionDocId(semesterId, userId) {
  return `weeklySelection_${String(semesterId || '').trim()}_${String(userId || '').trim()}`;
}

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

function getTimestamp(value) {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'object') {
    if (typeof value.getTime === 'function') {
      const timestamp = value.getTime();
      return Number.isFinite(timestamp) ? timestamp : 0;
    }

    if (typeof value.seconds === 'number') {
      const milliseconds = typeof value.milliseconds === 'number'
        ? value.milliseconds
        : (typeof value.nanoseconds === 'number' ? Math.floor(value.nanoseconds / 1e6) : 0);
      return value.seconds * 1000 + milliseconds;
    }
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function pickCanonicalSelection(selections = [], preferredId = '') {
  const normalizedPreferredId = String(preferredId || '').trim();

  return selections
    .slice()
    .sort((left, right) => {
      const leftIsPreferred = String(left && left._id || '') === normalizedPreferredId;
      const rightIsPreferred = String(right && right._id || '') === normalizedPreferredId;
      if (leftIsPreferred !== rightIsPreferred) {
        return leftIsPreferred ? -1 : 1;
      }

      const timestampDiff = getTimestamp(right && (right.updatedAt || right.createdAt))
        - getTimestamp(left && (left.updatedAt || left.createdAt));
      if (timestampDiff !== 0) {
        return timestampDiff;
      }

      return String(right && right._id || '').localeCompare(String(left && left._id || ''));
    })[0] || null;
}

function buildRecurringLeaderKey({ semesterId, dayOfWeek, shiftId, startTime, endTime }) {
  if (!semesterId && semesterId !== '') {
    return '';
  }

  if (shiftId) {
    return `${semesterId}::${dayOfWeek}::${shiftId}`;
  }

  return `${semesterId}::${dayOfWeek}::${startTime}::${endTime}`;
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

function createScheduleRecord({ semesterId, userId, userName, date, dayOfWeek, template, leaderInfo }) {
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
    overtimeStatus: '',
    overtimeRequestedAt: null,
    overtimeReviewedAt: null,
    overtimeReviewedBy: null,
    overtimeReviewedByName: '',
    leaveReason: '',
    leaveStatus: null,
    leaveApprovedBy: null,
    leaveApprovedAt: null,
    originalUserId: null,
    leaderUserId: leaderInfo && leaderInfo.leaderUserId ? leaderInfo.leaderUserId : null,
    leaderUserName: leaderInfo && leaderInfo.leaderUserName ? leaderInfo.leaderUserName : '',
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

async function loadRecurringLeaderMap(semesterId, preferences) {
  const recurringLeaderMap = {};
  const uniqueKeys = new Set();

  await Promise.all(preferences.map(async (item) => {
    const key = buildRecurringLeaderKey({
      semesterId,
      dayOfWeek: item.dayOfWeek,
      shiftId: item.shiftId,
    });

    if (!key || uniqueKeys.has(key)) {
      return;
    }

    uniqueKeys.add(key);

    const schedules = await loadAllDocuments(db.collection('schedules'), {
      semesterId,
      dayOfWeek: item.dayOfWeek,
      shiftId: item.shiftId,
    });

    const leaderSchedule = schedules.find((schedule) => String(schedule.leaderUserId || '').trim());
    if (!leaderSchedule) {
      return;
    }

    recurringLeaderMap[key] = {
      leaderUserId: String(leaderSchedule.leaderUserId || '').trim(),
      leaderUserName: String(leaderSchedule.leaderUserName || '').trim(),
    };
  }));

  return recurringLeaderMap;
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

    const preferredSelectionId = buildSelectionDocId(semesterId, userId);
    let selection = null;

    try {
      const preferredSelectionResult = await db.collection('weeklySelections').doc(preferredSelectionId).get();
      selection = preferredSelectionResult.data || null;
    } catch (error) {
      const selectionResult = await db.collection('weeklySelections')
        .where({ semesterId, userId })
        .limit(20)
        .get();
      selection = pickCanonicalSelection(selectionResult.data || [], preferredSelectionId);
    }

    const preferences = sanitizePreferences(selection ? selection.preferences : []);
    const recurringLeaderMap = await loadRecurringLeaderMap(semesterId, preferences);

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

          const leaderInfo = recurringLeaderMap[buildRecurringLeaderKey({
            semesterId,
            dayOfWeek,
            shiftId: template._id,
            startTime: template.startTime,
            endTime: template.endTime,
          })] || null;

          schedulesToCreate.push(createScheduleRecord({
            semesterId,
            userId,
            userName,
            date,
            dayOfWeek,
            template,
            leaderInfo,
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
