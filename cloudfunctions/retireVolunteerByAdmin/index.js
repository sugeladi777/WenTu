const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const SHIFT_TYPE_LEAVE = 1;
const LEAVE_STATUS_PENDING = 0;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];

function normalizeRoles(user = {}) {
  const roles = [];

  if (Array.isArray(user.roles)) {
    user.roles.forEach((item) => {
      const role = Number(item);
      if (VALID_ROLES.includes(role) && !roles.includes(role)) {
        roles.push(role);
      }
    });
  }

  const legacyRole = Number(user.role);
  if (!roles.length && VALID_ROLES.includes(legacyRole)) {
    roles.push(legacyRole);
  }

  if (!roles.includes(ROLE_MEMBER)) {
    roles.push(ROLE_MEMBER);
  }

  return roles.sort((left, right) => left - right);
}

function hasRole(user, role) {
  return normalizeRoles(user).includes(role);
}

function getPrimaryRole(roles) {
  if (roles.includes(ROLE_ADMIN)) {
    return ROLE_ADMIN;
  }

  if (roles.includes(ROLE_LEADER)) {
    return ROLE_LEADER;
  }

  return ROLE_MEMBER;
}

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

function isFutureUnstartedSchedule(schedule, today, currentMinutes) {
  if (!schedule || !schedule.date) {
    return false;
  }

  if (schedule.date > today) {
    return true;
  }

  if (schedule.date < today) {
    return false;
  }

  const startMinutes = timeToMinutes(schedule.startTime);
  if (startMinutes === null) {
    return false;
  }

  return currentMinutes < startMinutes;
}

function buildSlotMatcher(schedule = {}) {
  if (schedule.shiftId) {
    return {
      date: schedule.date,
      shiftId: schedule.shiftId,
    };
  }

  if (schedule.date && schedule.startTime && schedule.endTime) {
    return {
      date: schedule.date,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    };
  }

  return null;
}

async function loadAllDocuments(collection, filter = {}, options = {}) {
  const pageSize = options.pageSize || 100;
  const documents = [];
  let offset = 0;

  while (true) {
    const query = collection.where(filter).skip(offset).limit(pageSize);

    const result = await query.get();
    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
}

async function loadOptionalDocuments(collectionName, filter = {}, options = {}) {
  try {
    return await loadAllDocuments(db.collection(collectionName), filter, options);
  } catch (error) {
    const message = String(error && error.message ? error.message : '');
    if (/collection/i.test(message) && /not\s*exist/i.test(message)) {
      return [];
    }
    throw error;
  }
}

async function removeDocuments(collectionName, docIds = []) {
  if (!docIds.length) {
    return 0;
  }

  const collection = db.collection(collectionName);
  const batchSize = 20;

  for (let index = 0; index < docIds.length; index += batchSize) {
    const batch = docIds.slice(index, index + batchSize);
    await Promise.all(batch.map((docId) => collection.doc(docId).remove()));
  }

  return docIds.length;
}

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !hasRole(user, ROLE_ADMIN)) {
    throw new Error('只有管理员可以执行该操作');
  }

  return user;
}

async function syncLeaderRole(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return;
  }

  const userResult = await db.collection('users').doc(normalizedUserId).get();
  const user = userResult.data || null;
  if (!user) {
    return;
  }

  const currentRoles = normalizeRoles(user);
  const leaderScheduleResult = await db.collection('schedules')
    .where({
      userId: normalizedUserId,
      leaderUserId: normalizedUserId,
      shiftType: db.command.neq(SHIFT_TYPE_LEAVE),
    })
    .limit(1)
    .get();

  const hasLeaderAssignment = Boolean(leaderScheduleResult.data && leaderScheduleResult.data.length > 0);
  const nextRoles = hasLeaderAssignment
    ? [...new Set([...currentRoles, ROLE_LEADER])].sort((left, right) => left - right)
    : currentRoles.filter((item) => item !== ROLE_LEADER);
  const primaryRole = getPrimaryRole(nextRoles);
  const rawRoles = Array.isArray(user.roles) ? user.roles : [];
  const shouldUpdate = rawRoles.length !== nextRoles.length
    || rawRoles.some((item, index) => Number(item) !== nextRoles[index])
    || Number(user.role) !== primaryRole;

  if (!shouldUpdate) {
    return;
  }

  await db.collection('users').doc(normalizedUserId).update({
    data: {
      roles: nextRoles,
      role: primaryRole,
      updatedAt: db.serverDate(),
    },
  });
}

async function clearSlotLeaderAssignments(slotMatchers = [], targetUserId = '') {
  const normalizedTargetUserId = String(targetUserId || '').trim();
  if (!normalizedTargetUserId || !slotMatchers.length) {
    return 0;
  }

  let clearedSlotCount = 0;

  for (const slotMatcher of slotMatchers) {
    if (!slotMatcher) {
      continue;
    }

    const slotSchedules = await loadAllDocuments(
      db.collection('schedules'),
      slotMatcher,
    );

    if (!slotSchedules.length) {
      continue;
    }

    const needsClear = slotSchedules.some((item) => {
      return String(item.leaderUserId || '').trim() === normalizedTargetUserId;
    });

    if (!needsClear) {
      continue;
    }

    clearedSlotCount += 1;

    await Promise.all(slotSchedules.map((item) => {
      return db.collection('schedules').doc(item._id).update({
        data: {
          leaderUserId: null,
          leaderUserName: '',
          updatedAt: db.serverDate(),
        },
      });
    }));
  }

  return clearedSlotCount;
}

async function restoreClaimedLeaveSchedules(targetUserId, today, currentMinutes) {
  const claimedLeaveSchedules = await loadAllDocuments(db.collection('schedules'), {
    shiftType: SHIFT_TYPE_LEAVE,
    replacementUserId: targetUserId,
  });
  const restorableLeaveSchedules = claimedLeaveSchedules.filter((schedule) => {
    return isFutureUnstartedSchedule(schedule, today, currentMinutes);
  });

  for (const leaveSchedule of restorableLeaveSchedules) {
    await db.collection('schedules').doc(leaveSchedule._id).update({
      data: {
        leaveStatus: LEAVE_STATUS_PENDING,
        replacementUserId: null,
        replacementUserName: '',
        replacementScheduleId: null,
        leaveApprovedAt: null,
        updatedAt: db.serverDate(),
      },
    });
  }

  return restorableLeaveSchedules.length;
}

function buildResultMessage(result = {}) {
  const parts = [];

  parts.push(`已删除 ${result.removedFutureScheduleCount || 0} 个未来班次`);
  parts.push(`清空 ${result.removedWeeklySelectionCount || 0} 条固定班次选择`);

  if (result.removedShiftRequestCount) {
    parts.push(`移除 ${result.removedShiftRequestCount} 条待处理调班申请`);
  }

  if (result.removedLeaderApplicationCount) {
    parts.push(`移除 ${result.removedLeaderApplicationCount} 条待审批班负申请`);
  }

  if (result.clearedLeaderSlotCount) {
    parts.push(`清除 ${result.clearedLeaderSlotCount} 个班次的班负标记`);
  }

  return parts.join('，');
}

exports.main = async (event = {}) => {
  const requesterId = String(event.requesterId || '').trim();
  const targetUserId = String(event.targetUserId || '').trim();

  if (!requesterId || !targetUserId) {
    return { success: false, error: '参数错误' };
  }

  try {
    await ensureAdmin(requesterId);

    const targetResult = await db.collection('users').doc(targetUserId).get();
    const targetUser = targetResult.data || null;
    if (!targetUser) {
      return { success: false, error: '目标志愿者不存在' };
    }

    const now = getChinaParts();
    const today = formatChinaDate();
    const currentMinutes = now.hour * 60 + now.minute;
    const schedules = await loadAllDocuments(
      db.collection('schedules'),
      { userId: targetUserId },
    );

    const removableSchedules = schedules.filter((schedule) => {
      return isFutureUnstartedSchedule(schedule, today, currentMinutes);
    });
    const removableScheduleIds = removableSchedules.map((item) => item._id);
    const removableScheduleIdSet = new Set(removableScheduleIds);
    const slotMatchers = removableSchedules.map((schedule) => buildSlotMatcher(schedule)).filter(Boolean);

    const pendingShiftRequests = await loadOptionalDocuments('shiftRequests', { status: 'pending' });
    const removableShiftRequestIds = pendingShiftRequests
      .filter((item) => {
        return removableScheduleIdSet.has(String(item.fromScheduleId || '').trim())
          || removableScheduleIdSet.has(String(item.toScheduleId || '').trim());
      })
      .map((item) => item._id);

    const pendingLeaderApplications = await loadOptionalDocuments('leaderApplications', {
      userId: targetUserId,
      status: 'pending',
    });
    const removableLeaderApplicationIds = pendingLeaderApplications.map((item) => item._id);

    const weeklySelections = await loadOptionalDocuments('weeklySelections', { userId: targetUserId });
    const removableWeeklySelectionIds = weeklySelections.map((item) => item._id);

    await restoreClaimedLeaveSchedules(targetUserId, today, currentMinutes);
    const removedFutureScheduleCount = await removeDocuments('schedules', removableScheduleIds);
    const removedShiftRequestCount = await removeDocuments('shiftRequests', removableShiftRequestIds);
    const removedLeaderApplicationCount = await removeDocuments('leaderApplications', removableLeaderApplicationIds);
    const removedWeeklySelectionCount = await removeDocuments('weeklySelections', removableWeeklySelectionIds);
    const clearedLeaderSlotCount = await clearSlotLeaderAssignments(slotMatchers, targetUserId);

    await syncLeaderRole(targetUserId);

    const result = {
      removedFutureScheduleCount,
      removedShiftRequestCount,
      removedLeaderApplicationCount,
      removedWeeklySelectionCount,
      clearedLeaderSlotCount,
    };

    return {
      success: true,
      ...result,
      message: buildResultMessage(result),
    };
  } catch (error) {
    return { success: false, error: error.message || '退岗失败' };
  }
};
