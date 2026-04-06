const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_LEAVE = 1;
const LEAVE_STATUS_PENDING = 0;

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
      .orderBy('date', 'asc')
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

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const semesterId = String(event.semesterId || '').trim();

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const now = getChinaParts();
    const today = formatChinaDate();
    const currentMinutes = now.hour * 60 + now.minute;
    const baseQuery = {
      date: db.command.gte(today),
      shiftType: SHIFT_TYPE_LEAVE,
      leaveStatus: LEAVE_STATUS_PENDING,
    };

    if (semesterId) {
      baseQuery.semesterId = semesterId;
    }

    const schedules = await loadAllDocuments(db.collection('schedules'), baseQuery);

    const availableList = schedules
      .filter((schedule) => {
        if (!schedule || schedule.userId === userId) {
          return false;
        }

        if (schedule.checkInTime || schedule.checkOutTime) {
          return false;
        }

        if (schedule.replacementScheduleId || schedule.replacementUserId) {
          return false;
        }

        if (hasShiftStarted(schedule, today, currentMinutes)) {
          return false;
        }

        return true;
      })
      .sort((left, right) => {
        if (left.date !== right.date) {
          return String(left.date || '').localeCompare(String(right.date || ''));
        }

        return String(left.startTime || '').localeCompare(String(right.startTime || ''));
      });

    return {
      success: true,
      schedules: availableList,
      count: availableList.length,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
