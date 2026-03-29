const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_LEAVE = 1;

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function toChinaDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const offsetMinutes = 8 * 60 + date.getTimezoneOffset();
  return new Date(date.getTime() + offsetMinutes * 60 * 1000);
}

function getChinaParts(input = new Date()) {
  const chinaDate = toChinaDate(input);
  return {
    year: chinaDate.getUTCFullYear(),
    month: chinaDate.getUTCMonth() + 1,
    day: chinaDate.getUTCDate(),
    hour: chinaDate.getUTCHours(),
    minute: chinaDate.getUTCMinutes(),
  };
}

function formatChinaDate(input = new Date()) {
  const parts = getChinaParts(input);
  return `${parts.year}-${padNumber(parts.month)}-${padNumber(parts.day)}`;
}

function parseDateString(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
  if (!match) {
    return null;
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function hasShiftStarted(schedule, today, currentMinutes) {
  if (!schedule || !schedule.date) {
    return true;
  }

  if (schedule.date < today) {
    return true;
  }

  if (schedule.date > today) {
    return false;
  }

  const startMinutes = timeToMinutes(schedule.startTime);
  if (startMinutes === null) {
    return true;
  }

  return currentMinutes >= startMinutes;
}

async function loadAllDocuments(collection, filter) {
  const documents = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const result = await collection
      .where(filter)
      .skip(offset)
      .limit(pageSize)
      .get();

    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
}

function buildSlotKey(record) {
  if (record.shiftId) {
    return String(record.shiftId);
  }

  return `${record.startTime || ''}::${record.endTime || ''}`;
}

function hasTimeConflict(template, schedule) {
  if (!template || !schedule) {
    return false;
  }

  const templateStart = timeToMinutes(template.startTime);
  const templateEnd = timeToMinutes(template.endTime);
  const scheduleStart = timeToMinutes(schedule.startTime);
  const scheduleEnd = timeToMinutes(schedule.endTime);

  if (
    templateStart === null
    || templateEnd === null
    || scheduleStart === null
    || scheduleEnd === null
  ) {
    return false;
  }

  return templateStart < scheduleEnd && scheduleStart < templateEnd;
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const semesterId = String(event.semesterId || '').trim();
  const date = String(event.date || '').trim();

  if (!userId || !semesterId || !date) {
    return { success: false, error: '参数错误' };
  }

  try {
    const semesterResult = await db.collection('semesters').doc(semesterId).get();
    const semester = semesterResult.data || null;

    if (!semester) {
      return { success: false, error: '学期不存在' };
    }

    if (date < String(semester.startDate || '') || date > String(semester.endDate || '')) {
      return { success: false, error: '日期不在当前学期范围内' };
    }

    const today = formatChinaDate();
    const nowParts = getChinaParts();
    const currentMinutes = nowParts.hour * 60 + nowParts.minute;
    const dayOfWeekDate = parseDateString(date);
    const day = dayOfWeekDate ? dayOfWeekDate.getDay() : null;
    const dayOfWeek = day === null ? null : (day === 0 ? 6 : day - 1);

    const [templateList, mySchedules, dateSchedules] = await Promise.all([
      loadAllDocuments(db.collection('shiftTemplates'), { semesterId }),
      loadAllDocuments(db.collection('schedules'), { semesterId, userId, date }),
      loadAllDocuments(db.collection('schedules'), { semesterId, date }),
    ]);

    const slotMetaMap = {};
    dateSchedules.forEach((schedule) => {
      const key = buildSlotKey(schedule);
      if (!slotMetaMap[key]) {
        slotMetaMap[key] = {
          assignedCount: 0,
          leaderUserId: '',
          leaderUserName: '',
        };
      }

      if (schedule.shiftType !== SHIFT_TYPE_LEAVE) {
        slotMetaMap[key].assignedCount += 1;
      }

      if (!slotMetaMap[key].leaderUserId && String(schedule.leaderUserId || '').trim()) {
        slotMetaMap[key].leaderUserId = String(schedule.leaderUserId || '').trim();
        slotMetaMap[key].leaderUserName = String(schedule.leaderUserName || '').trim();
      }
    });

    const templates = templateList
      .sort((left, right) => {
        return String(left.startTime || '').localeCompare(String(right.startTime || ''));
      })
      .map((template) => {
        const slotKey = buildSlotKey(template);
        const sameSlotSchedule = mySchedules.find((item) => buildSlotKey(item) === slotKey);
        const conflictSchedule = sameSlotSchedule || mySchedules.find((item) => hasTimeConflict(template, item));
        const started = hasShiftStarted({
          date,
          startTime: template.startTime,
        }, today, currentMinutes);

        let canJoin = true;
        let statusText = '可添加';

        if (started) {
          canJoin = false;
          statusText = '班次已开始';
        } else if (sameSlotSchedule) {
          canJoin = false;
          statusText = '已在我的班次';
        } else if (conflictSchedule) {
          canJoin = false;
          statusText = '与现有班次冲突';
        }

        const slotMeta = slotMetaMap[slotKey] || {};

        return {
          shiftId: String(template._id || ''),
          shiftName: String(template.name || ''),
          startTime: String(template.startTime || ''),
          endTime: String(template.endTime || ''),
          fixedHours: Number(template.fixedHours) || 0,
          maxCapacity: Number(template.maxCapacity) || 0,
          date,
          dayOfWeek,
          canJoin,
          statusText,
          assignedCount: Number(slotMeta.assignedCount || 0),
          leaderUserId: slotMeta.leaderUserId || '',
          leaderUserName: slotMeta.leaderUserName || '',
        };
      });

    return {
      success: true,
      selectedDate: date,
      templates,
      count: templates.length,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
