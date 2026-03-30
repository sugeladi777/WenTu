const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const SHIFT_TYPE_LEAVE = 1;
const SHIFT_TYPE_SWAP = 2;
const LEAVE_STATUS_PENDING = 0;
const LEAVE_STATUS_APPROVED = 1;
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

function hasTimeConflict(candidate, existing) {
  if (!candidate || !existing || candidate.date !== existing.date) {
    return false;
  }

  const candidateStart = timeToMinutes(candidate.startTime);
  const candidateEnd = timeToMinutes(candidate.endTime);
  const existingStart = timeToMinutes(existing.startTime);
  const existingEnd = timeToMinutes(existing.endTime);

  if ([candidateStart, candidateEnd, existingStart, existingEnd].some((value) => value === null)) {
    return false;
  }

  return candidateStart < existingEnd && candidateEnd > existingStart;
}

function buildSlotMatcher(schedule = {}) {
  if (schedule.shiftId) {
    return {
      date: schedule.date,
      shiftId: schedule.shiftId,
    };
  }

  return {
    date: schedule.date,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
  };
}

function buildRecurringMatcher(schedule = {}) {
  const semesterId = String(schedule.semesterId || '').trim();
  const dayOfWeek = Number(schedule.dayOfWeek);

  if (!semesterId || Number.isNaN(dayOfWeek)) {
    return null;
  }

  const matcher = {
    semesterId,
    dayOfWeek,
  };

  if (schedule.shiftId) {
    matcher.shiftId = schedule.shiftId;
    return matcher;
  }

  if (!schedule.startTime || !schedule.endTime) {
    return null;
  }

  matcher.startTime = schedule.startTime;
  matcher.endTime = schedule.endTime;
  return matcher;
}

function isSameSlot(left = {}, right = {}) {
  if (!left || !right || String(left.date || '') !== String(right.date || '')) {
    return false;
  }

  if (left.shiftId || right.shiftId) {
    return String(left.shiftId || '') === String(right.shiftId || '');
  }

  return String(left.startTime || '') === String(right.startTime || '')
    && String(left.endTime || '') === String(right.endTime || '');
}

function getSlotLeaderInfo(slotSchedules = []) {
  const leaderSchedule = slotSchedules.find((item) => {
    return item
      && item.shiftType !== SHIFT_TYPE_LEAVE
      && String(item.leaderUserId || '').trim();
  }) || null;

  return {
    leaderUserId: leaderSchedule ? String(leaderSchedule.leaderUserId || '').trim() : '',
    leaderUserName: leaderSchedule ? String(leaderSchedule.leaderUserName || '').trim() : '',
  };
}

function buildReplacementSchedule(leaveSchedule, userId, userName, leaderInfo = {}) {
  return {
    semesterId: leaveSchedule.semesterId,
    userId,
    userName,
    date: leaveSchedule.date,
    dayOfWeek: leaveSchedule.dayOfWeek,
    shiftId: leaveSchedule.shiftId,
    shiftName: leaveSchedule.shiftName,
    startTime: leaveSchedule.startTime,
    endTime: leaveSchedule.endTime,
    fixedHours: Number(leaveSchedule.fixedHours) || 0,
    shiftType: SHIFT_TYPE_SWAP,
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
    originalUserId: leaveSchedule.userId,
    originalUserName: leaveSchedule.userName || '',
    relatedLeaveScheduleId: leaveSchedule._id,
    leaderUserId: leaderInfo.leaderUserId || null,
    leaderUserName: leaderInfo.leaderUserName || '',
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

async function detectLeaderLeave(leaveSchedule) {
  const releasedLeaderUserId = String(leaveSchedule.leaveReleasedLeaderUserId || '').trim();
  const requesterId = String(leaveSchedule.leaveRequesterId || leaveSchedule.userId || '').trim();

  if (releasedLeaderUserId && requesterId && releasedLeaderUserId === requesterId) {
    return true;
  }

  if (String(leaveSchedule.leaderUserId || '').trim() === requesterId && requesterId) {
    return true;
  }

  const recurringMatcher = buildRecurringMatcher(leaveSchedule);
  if (!recurringMatcher || !requesterId) {
    return false;
  }

  const result = await db.collection('schedules')
    .where({
      ...recurringMatcher,
      leaderUserId: requesterId,
      shiftType: db.command.neq(SHIFT_TYPE_LEAVE),
    })
    .limit(1)
    .get();

  return Boolean(result.data && result.data.length > 0);
}

async function assignSlotLeader(slotSchedules, leaderUserId, leaderUserName) {
  const normalizedLeaderUserId = String(leaderUserId || '').trim();
  const normalizedLeaderUserName = String(leaderUserName || '').trim();
  const tasks = (slotSchedules || [])
    .filter((item) => {
      const currentLeaderUserId = String(item.leaderUserId || '').trim();
      const currentLeaderUserName = String(item.leaderUserName || '').trim();
      return currentLeaderUserId !== normalizedLeaderUserId || currentLeaderUserName !== normalizedLeaderUserName;
    })
    .map((item) => {
      return db.collection('schedules').doc(item._id).update({
        data: {
          leaderUserId: normalizedLeaderUserId || null,
          leaderUserName: normalizedLeaderUserName || '',
          updatedAt: db.serverDate(),
        },
      });
    });

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

exports.main = async (event = {}) => {
  const userId = String(event.userId || '').trim();
  const userName = String(event.userName || '').trim();
  const scheduleId = String(event.scheduleId || '').trim();

  if (!userId || !userName || !scheduleId) {
    return { success: false, error: '参数错误' };
  }

  try {
    const [leaveScheduleResult, claimantResult] = await Promise.all([
      db.collection('schedules').doc(scheduleId).get(),
      db.collection('users').doc(userId).get(),
    ]);
    const leaveSchedule = leaveScheduleResult.data || null;
    const claimant = claimantResult.data || null;

    if (!leaveSchedule) {
      return { success: false, error: '请假班次不存在' };
    }

    if (!claimant) {
      return { success: false, error: '认领用户不存在' };
    }

    if (leaveSchedule.userId === userId) {
      return { success: false, error: '不能认领自己的请假班次' };
    }

    if (leaveSchedule.shiftType !== SHIFT_TYPE_LEAVE || leaveSchedule.leaveStatus !== LEAVE_STATUS_PENDING) {
      return { success: false, error: '该班次当前不可替班' };
    }

    if (leaveSchedule.replacementScheduleId || leaveSchedule.replacementUserId) {
      return { success: false, error: '该班次已经被其他同学认领了' };
    }

    if (leaveSchedule.checkInTime || leaveSchedule.checkOutTime) {
      return { success: false, error: '该班次已产生考勤记录，不能再替班' };
    }

    const now = getChinaParts();
    const today = formatChinaDate();
    const currentMinutes = now.hour * 60 + now.minute;

    if (hasShiftStarted(leaveSchedule, today, currentMinutes)) {
      return { success: false, error: '只能认领尚未开始的班次' };
    }

    const [slotSchedules, mySchedules] = await Promise.all([
      loadAllDocuments(db.collection('schedules'), buildSlotMatcher(leaveSchedule)),
      loadAllDocuments(db.collection('schedules'), {
        userId,
        date: leaveSchedule.date,
        ...(leaveSchedule.semesterId ? { semesterId: leaveSchedule.semesterId } : {}),
      }),
    ]);

    const slotLeaderInfo = getSlotLeaderInfo(slotSchedules);
    const slotAlreadyHasLeader = Boolean(slotLeaderInfo.leaderUserId);
    const sameSlotSchedule = mySchedules.find((schedule) => {
      return schedule
        && schedule.shiftType !== SHIFT_TYPE_LEAVE
        && isSameSlot(schedule, leaveSchedule);
    }) || null;
    const otherConflictSchedule = mySchedules.find((schedule) => {
      return schedule
        && (!sameSlotSchedule || schedule._id !== sameSlotSchedule._id)
        && hasTimeConflict(leaveSchedule, schedule);
    }) || null;

    if (otherConflictSchedule) {
      return { success: false, error: '你在该时间段已经有其他班次，无法替班' };
    }

    const isLeaderLeave = await detectLeaderLeave(leaveSchedule);
    const claimantCanTakeLeader = hasRole(claimant, ROLE_LEADER) || hasRole(claimant, ROLE_ADMIN);
    const canTakeOverLeaderOnly = Boolean(
      sameSlotSchedule
      && isLeaderLeave
      && claimantCanTakeLeader
      && !slotAlreadyHasLeader,
    );

    if (sameSlotSchedule && !canTakeOverLeaderOnly) {
      return { success: false, error: '你在该时间段已经有其他班次，无法替班' };
    }

    if (canTakeOverLeaderOnly) {
      await assignSlotLeader(slotSchedules, userId, userName);

      await db.collection('schedules').doc(scheduleId).update({
        data: {
          leaveStatus: LEAVE_STATUS_APPROVED,
          replacementUserId: userId,
          replacementUserName: userName,
          replacementScheduleId: sameSlotSchedule._id,
          leaveApprovedAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });

      await syncLeaderRole(userId);

      return {
        success: true,
        message: '已接任当前班次的班负职责',
        replacementScheduleId: sameSlotSchedule._id,
        usedExistingSchedule: true,
      };
    }

    const replacementLeaderInfo = (isLeaderLeave && claimantCanTakeLeader && !slotAlreadyHasLeader)
      ? { leaderUserId: userId, leaderUserName: userName }
      : slotLeaderInfo;
    const replacementResult = await db.collection('schedules').add({
      data: buildReplacementSchedule(leaveSchedule, userId, userName, replacementLeaderInfo),
    });

    if (isLeaderLeave && claimantCanTakeLeader && !slotAlreadyHasLeader) {
      await assignSlotLeader(slotSchedules, userId, userName);
      await syncLeaderRole(userId);
    }

    await db.collection('schedules').doc(scheduleId).update({
      data: {
        leaveStatus: LEAVE_STATUS_APPROVED,
        replacementUserId: userId,
        replacementUserName: userName,
        replacementScheduleId: replacementResult._id,
        leaveApprovedAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });

    return {
      success: true,
      message: '替班认领成功',
      replacementScheduleId: replacementResult._id,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
