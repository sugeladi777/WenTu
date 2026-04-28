const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_LEAVE = 1;
const SHIFT_TYPE_SWAP = 2;

async function loadAllDocuments(collection, filter) {
  const pageSize = 100;
  const documents = [];
  let offset = 0;

  while (true) {
    const result = await collection.where(filter).orderBy('date', 'asc').skip(offset).limit(pageSize).get();
    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
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

exports.main = async (event = {}) => {
  const userId = String(event.userId || '').trim();
  const semesterId = String(event.semesterId || '').trim();
  const startDate = String(event.startDate || '').trim();
  const endDate = String(event.endDate || '').trim();

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const query = { userId };

    if (semesterId) {
      query.semesterId = semesterId;
    }

    if (startDate && endDate) {
      query.date = db.command.gte(startDate).and(db.command.lte(endDate));
    }

    const schedules = await attachLeaveCountMeta(await loadAllDocuments(db.collection('schedules'), query));
    schedules.sort((left, right) => {
      if (left.date !== right.date) {
        return String(left.date || '').localeCompare(String(right.date || ''));
      }

      return String(left.startTime || '').localeCompare(String(right.startTime || ''));
    });

    return {
      success: true,
      schedules,
      count: schedules.length,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
