const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_LEAVE = 1;
const SHIFT_TYPE_SWAP = 2;

function padNumber(value) {
  return String(value).padStart(2, '0');
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

async function loadReplacementScheduleMap(schedules = []) {
  const replacementScheduleIds = [...new Set(
    schedules
      .filter((item) => item && Number(item.shiftType) === SHIFT_TYPE_LEAVE)
      .map((item) => String(item.replacementScheduleId || '').trim())
      .filter(Boolean)
  )];

  const entries = await Promise.all(replacementScheduleIds.map(async (scheduleId) => {
    try {
      const result = await db.collection('schedules').doc(scheduleId).get();
      return result.data ? [scheduleId, result.data] : null;
    } catch (error) {
      return null;
    }
  }));

  return entries.reduce((map, entry) => {
    if (entry) {
      map[entry[0]] = entry[1];
    }

    return map;
  }, {});
}

function shouldCountAsLeave(schedule = {}, replacementScheduleMap = {}) {
  if (!schedule || Number(schedule.shiftType) !== SHIFT_TYPE_LEAVE) {
    return false;
  }

  if (typeof schedule.leaveCountsAsLeave === 'boolean') {
    return schedule.leaveCountsAsLeave;
  }

  if (!schedule.replacementUserId && !schedule.replacementScheduleId) {
    return true;
  }

  const replacementScheduleId = String(schedule.replacementScheduleId || '').trim();
  const replacementSchedule = replacementScheduleId ? replacementScheduleMap[replacementScheduleId] : null;

  if (replacementSchedule) {
    return Number(replacementSchedule.shiftType) !== SHIFT_TYPE_SWAP;
  }

  return false;
}

async function attachLeaveCountMeta(schedules = []) {
  const replacementScheduleMap = await loadReplacementScheduleMap(schedules);

  return schedules.map((schedule) => {
    if (Number(schedule.shiftType) !== SHIFT_TYPE_LEAVE) {
      return schedule;
    }

    return {
      ...schedule,
      leaveCountsAsLeave: shouldCountAsLeave(schedule, replacementScheduleMap),
    };
  });
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const date = String(event.date || '').trim() || formatChinaDate();

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const result = await db.collection('schedules')
      .where({ userId, date })
      .orderBy('startTime', 'asc')
      .limit(100)
      .get();

    const schedules = await attachLeaveCountMeta(result.data || []);

    return {
      success: true,
      schedules,
      count: schedules.length,
      date,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
