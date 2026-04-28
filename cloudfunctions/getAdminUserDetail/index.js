const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];
const ATTENDANCE_NORMAL = 0;
const ATTENDANCE_LATE = 1;
const ATTENDANCE_MISSING_CHECKOUT = 2;
const ATTENDANCE_ABSENT = 3;
const SHIFT_TYPE_LEAVE = 1;

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function roundNumber(value) {
  return Math.round(Number(value || 0) * 100) / 100;
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

function getChinaMinutes(input = new Date()) {
  const chinaDate = toChinaDate(input);
  return chinaDate.getUTCHours() * 60 + chinaDate.getUTCMinutes();
}

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

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

function omitPassword(user) {
  if (!user) {
    return null;
  }

  const { password, ...userInfo } = user;
  const roles = normalizeRoles(user);
  const primaryRole = getPrimaryRole(roles);

  return {
    ...userInfo,
    nickname: '',
    roles,
    role: primaryRole,
    primaryRole,
  };
}

async function syncUserRoleFields(user) {
  if (!user || !user._id) {
    return user;
  }

  const normalizedRoles = normalizeRoles(user);
  const leaderScheduleResult = await db.collection('schedules')
    .where({
      userId: user._id,
      leaderUserId: user._id,
      shiftType: db.command.neq(SHIFT_TYPE_LEAVE),
    })
    .limit(1)
    .get();

  const hasLeaderAssignment = Boolean(leaderScheduleResult.data && leaderScheduleResult.data.length > 0);
  const roles = hasLeaderAssignment
    ? [...new Set([...normalizedRoles, ROLE_LEADER])].sort((left, right) => left - right)
    : normalizedRoles.filter((item) => item !== ROLE_LEADER);
  const currentRoles = Array.isArray(user.roles) ? user.roles : [];
  const primaryRole = getPrimaryRole(roles);
  const shouldUpdate = currentRoles.length !== roles.length
    || currentRoles.some((item, index) => Number(item) !== roles[index])
    || Number(user.role) !== primaryRole;

  if (!shouldUpdate) {
    return {
      ...user,
      roles,
      role: primaryRole,
    };
  }

  await db.collection('users').doc(user._id).update({
    data: {
      roles,
      role: primaryRole,
      updatedAt: db.serverDate(),
    },
  });

  return {
    ...user,
    roles,
    role: primaryRole,
  };
}

async function loadAllDocuments(collection, filter = {}) {
  const pageSize = 100;
  const documents = [];
  let offset = 0;

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

async function findSemester(semesterId) {
  if (semesterId) {
    const result = await db.collection('semesters').doc(semesterId).get();
    return result.data || null;
  }

  const today = formatChinaDate();
  const activeResult = await db.collection('semesters')
    .where({
      status: 'active',
      startDate: db.command.lte(today),
      endDate: db.command.gte(today),
    })
    .orderBy('startDate', 'desc')
    .limit(1)
    .get();

  if (activeResult.data && activeResult.data[0]) {
    return activeResult.data[0];
  }

  const latestResult = await db.collection('semesters')
    .where({ status: 'active' })
    .orderBy('startDate', 'desc')
    .limit(1)
    .get();

  return latestResult.data && latestResult.data[0] ? latestResult.data[0] : null;
}

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !hasRole(user, ROLE_ADMIN)) {
    throw new Error('只有管理员可以执行该操作');
  }

  return user;
}

function getEffectiveAttendanceStatus(schedule = {}) {
  if (!schedule || Number(schedule.shiftType) === SHIFT_TYPE_LEAVE) {
    return schedule ? schedule.attendanceStatus : null;
  }

  if (schedule.attendanceStatus === ATTENDANCE_ABSENT) {
    return ATTENDANCE_ABSENT;
  }

  if (schedule.attendanceStatus === ATTENDANCE_MISSING_CHECKOUT) {
    return ATTENDANCE_MISSING_CHECKOUT;
  }

  if (schedule.checkOutTime) {
    return schedule.attendanceStatus;
  }

  if (!schedule.date) {
    return schedule.attendanceStatus;
  }

  const endMinutes = timeToMinutes(schedule.endTime);
  if (endMinutes === null) {
    return schedule.attendanceStatus;
  }

  const today = formatChinaDate();
  const currentMinutes = getChinaMinutes();
  const cutoffPassed = schedule.date < today || (schedule.date === today && currentMinutes > endMinutes + 30);

  if (!cutoffPassed) {
    return schedule.attendanceStatus;
  }

  if (!schedule.checkInTime) {
    return ATTENDANCE_ABSENT;
  }

  return ATTENDANCE_MISSING_CHECKOUT;
}

function getValidScheduleHours(schedule, effectiveAttendanceStatus) {
  const isValid = Boolean(
    schedule.checkOutTime
    && (effectiveAttendanceStatus === ATTENDANCE_NORMAL || effectiveAttendanceStatus === ATTENDANCE_LATE)
    && Number(schedule.shiftType) !== SHIFT_TYPE_LEAVE
    && effectiveAttendanceStatus !== ATTENDANCE_ABSENT
  );

  if (!isValid) {
    return 0;
  }

  const shiftHours = Number(schedule.fixedHours) || 0;
  const approvedOvertime = schedule.overtimeApproved ? (Number(schedule.overtimeHours) || 0) : 0;
  return roundNumber(shiftHours + approvedOvertime);
}

function createEmptySummary() {
  return {
    totalShifts: 0,
    completedShifts: 0,
    checkedInCount: 0,
    checkedOutCount: 0,
    leaveShifts: 0,
    lateShifts: 0,
    absentShifts: 0,
    missingCheckoutShifts: 0,
    validHours: 0,
    paidHours: 0,
    unpaidHours: 0,
    paidAmount: 0,
    paidShiftCount: 0,
    unpaidShiftCount: 0,
  };
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

function sortSchedules(list = []) {
  return list.slice().sort((left, right) => {
    if (left.date !== right.date) {
      return String(right.date || '').localeCompare(String(left.date || ''));
    }

    return String(right.startTime || '').localeCompare(String(left.startTime || ''));
  });
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const targetUserId = String(event.targetUserId || '').trim();
  const semesterId = String(event.semesterId || '').trim();

  if (!requesterId || !targetUserId) {
    return { success: false, error: '参数错误' };
  }

  try {
    await ensureAdmin(requesterId);

    const [semester, targetResult] = await Promise.all([
      findSemester(semesterId),
      db.collection('users').doc(targetUserId).get(),
    ]);

    const rawTargetUser = targetResult.data || null;
    const targetUser = rawTargetUser ? await syncUserRoleFields(rawTargetUser) : null;
    if (!targetUser) {
      return { success: false, error: '目标用户不存在' };
    }

    const schedules = semester
      ? await loadAllDocuments(db.collection('schedules'), {
        userId: targetUserId,
        semesterId: semester._id,
      })
      : [];

    const summary = createEmptySummary();
    const replacementScheduleMap = await loadReplacementScheduleMap(schedules);
    const scheduleList = sortSchedules(schedules).map((schedule) => {
      const effectiveAttendanceStatus = getEffectiveAttendanceStatus(schedule);
      const actualHours = getValidScheduleHours(schedule, effectiveAttendanceStatus);
      const leaveCountsAsLeave = shouldCountAsLeave(schedule, replacementScheduleMap);

      summary.totalShifts += 1;

      if (schedule.checkInTime) {
        summary.checkedInCount += 1;
      }

      if (schedule.checkOutTime) {
        summary.checkedOutCount += 1;
        summary.completedShifts += 1;
      }

      if (leaveCountsAsLeave) {
        summary.leaveShifts += 1;
      }

      if (effectiveAttendanceStatus === ATTENDANCE_LATE) {
        summary.lateShifts += 1;
      }

      if (effectiveAttendanceStatus === ATTENDANCE_ABSENT) {
        summary.absentShifts += 1;
      }

      if (effectiveAttendanceStatus === ATTENDANCE_MISSING_CHECKOUT) {
        summary.missingCheckoutShifts += 1;
      }

      if (actualHours > 0) {
        summary.validHours = roundNumber(summary.validHours + actualHours);

        if (schedule.salaryPaid) {
          summary.paidHours = roundNumber(summary.paidHours + actualHours);
          summary.paidAmount = roundNumber(summary.paidAmount + Number(schedule.salaryAmount || 0));
          summary.paidShiftCount += 1;
        } else {
          summary.unpaidHours = roundNumber(summary.unpaidHours + actualHours);
          summary.unpaidShiftCount += 1;
        }
      }

      return {
        ...schedule,
        attendanceStatus: effectiveAttendanceStatus,
        actualHours,
        hours: actualHours,
        fixedHours: roundNumber(schedule.fixedHours || 0),
        overtimeHours: roundNumber(schedule.overtimeHours || 0),
        salaryAmount: roundNumber(schedule.salaryAmount || 0),
        salaryRate: roundNumber(schedule.salaryRate || 0),
        isValid: actualHours > 0,
        leaveCountsAsLeave,
      };
    });

    return {
      success: true,
      semester,
      userInfo: omitPassword(targetUser),
      summary,
      schedules: scheduleList,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
