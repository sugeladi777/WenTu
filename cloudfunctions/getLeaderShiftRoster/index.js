const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];
const SHIFT_TYPE_LEAVE = 1;
const SHIFT_TYPE_SWAP = 2;
const SHIFT_TYPE_BORROW = 3;
const ATTENDANCE_MISSING_CHECKOUT = 2;
const ATTENDANCE_ABSENT = 3;

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

function resolveActiveRole(user, requestedActiveRole) {
  const roles = normalizeRoles(user);
  const activeRole = Number(requestedActiveRole);

  if (VALID_ROLES.includes(activeRole) && roles.includes(activeRole)) {
    return activeRole;
  }

  return getPrimaryRole(roles);
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
    roles,
    role: primaryRole,
    primaryRole,
  };
}

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

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function getLeaderConfirmText(schedule) {
  if (schedule.leaderConfirmStatus === 'present') {
    return '已确认签到';
  }

  if (schedule.leaderConfirmStatus === 'absent') {
    return '已确认旷岗';
  }

  if (schedule.checkInTime) {
    return '班负未确认签到';
  }

  return '待签到';
}

function getLeaderConfirmClass(schedule) {
  if (schedule.leaderConfirmStatus === 'present') {
    return 'success';
  }

  if (schedule.leaderConfirmStatus === 'absent') {
    return 'danger';
  }

  if (schedule.checkInTime) {
    return 'warning';
  }

  return 'muted';
}

function getOvertimeText(schedule) {
  const overtimeHours = Math.round(Number(schedule.overtimeHours || 0) * 100) / 100;

  if (!overtimeHours) {
    return '未申请加班';
  }

  if (schedule.overtimeStatus === 'approved' || schedule.overtimeApproved) {
    return `加班已通过 ${overtimeHours} 小时`;
  }

  if (schedule.overtimeStatus === 'rejected') {
    return `加班已驳回 ${overtimeHours} 小时`;
  }

  if (schedule.overtimeStatus === 'pending') {
    return `加班待审批 ${overtimeHours} 小时`;
  }

  return `已填写加班 ${overtimeHours} 小时`;
}

function getOvertimeClass(schedule) {
  if (!Number(schedule.overtimeHours || 0)) {
    return 'muted';
  }

  if (schedule.overtimeStatus === 'approved' || schedule.overtimeApproved) {
    return 'success';
  }

  if (schedule.overtimeStatus === 'rejected') {
    return 'danger';
  }

  if (schedule.overtimeStatus === 'pending') {
    return 'warning';
  }

  return 'primary';
}

function getParticipantTypeText(schedule) {
  if (!schedule) {
    return '';
  }

  if (schedule.shiftType === SHIFT_TYPE_SWAP) {
    return '替班';
  }

  if (schedule.shiftType === SHIFT_TYPE_BORROW) {
    return '蹭班';
  }

  return '';
}

function getParticipantTypeClass(schedule) {
  if (!schedule) {
    return '';
  }

  if (schedule.shiftType === SHIFT_TYPE_SWAP) {
    return 'primary';
  }

  if (schedule.shiftType === SHIFT_TYPE_BORROW) {
    return 'warning';
  }

  return '';
}

function buildSlotMatcher(schedule) {
  if (schedule.shiftId) {
    return { date: schedule.date, shiftId: schedule.shiftId };
  }

  return {
    date: schedule.date,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
  };
}

function buildSlotKey(schedule = {}) {
  if (schedule.shiftId) {
    return `${schedule.date || ''}::${schedule.shiftId || ''}`;
  }

  return `${schedule.date || ''}::${schedule.startTime || ''}::${schedule.endTime || ''}`;
}

function buildLeaderScheduleList(scheduleList = []) {
  const slotMap = {};

  scheduleList.forEach((item) => {
    const slotKey = buildSlotKey(item);
    if (!slotKey) {
      return;
    }

    const current = slotMap[slotKey];
    if (!current) {
      slotMap[slotKey] = item;
      return;
    }

    const currentShiftType = Number(current.shiftType);
    const nextShiftType = Number(item.shiftType);
    if (currentShiftType === SHIFT_TYPE_SWAP && nextShiftType !== SHIFT_TYPE_SWAP) {
      slotMap[slotKey] = item;
    }
  });

  return Object.values(slotMap).sort((left, right) => {
    if (String(left.date || '') !== String(right.date || '')) {
      return String(left.date || '').localeCompare(String(right.date || ''));
    }

    const timeCompare = String(left.startTime || '').localeCompare(String(right.startTime || ''));
    if (timeCompare !== 0) {
      return timeCompare;
    }

    return String(left.shiftName || '').localeCompare(String(right.shiftName || ''));
  });
}

function isTodaySchedule(schedule, today) {
  return Boolean(schedule) && String(schedule.date || '') === String(today || '');
}

function isFutureSchedule(schedule, today) {
  return Boolean(schedule) && String(schedule.date || '') > String(today || '');
}

function selectActiveShift(leaderSchedules, selectedScheduleId, today, currentMinutes) {
  if (!leaderSchedules.length) {
    return null;
  }

  if (selectedScheduleId) {
    const selected = leaderSchedules.find((item) => item._id === selectedScheduleId);
    if (selected) {
      return selected;
    }
  }

  const currentShift = leaderSchedules.find((item) => {
    if (!isTodaySchedule(item, today)) {
      return false;
    }

    const start = timeToMinutes(item.startTime);
    const end = timeToMinutes(item.endTime);
    return start !== null && end !== null && currentMinutes >= start - 15 && currentMinutes <= end + 30;
  });

  if (currentShift) {
    return currentShift;
  }

  const upcoming = leaderSchedules.find((item) => {
    if (!isTodaySchedule(item, today)) {
      return false;
    }

    const start = timeToMinutes(item.startTime);
    return start !== null && currentMinutes < start;
  });

  if (upcoming) {
    return upcoming;
  }

  const future = leaderSchedules.find((item) => isFutureSchedule(item, today));
  return future || leaderSchedules[0];
}

async function ensureRequester(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user) {
    throw new Error('请求用户不存在');
  }

  return user;
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const selectedScheduleId = String(event.scheduleId || '').trim();
  const today = formatChinaDate();

  if (!requesterId) {
    return { success: false, error: '请求用户不能为空' };
  }

  try {
    const requester = await ensureRequester(requesterId);
    const activeRole = resolveActiveRole(requester, event.activeRole);
    const now = toChinaDate();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    let leaderSchedules = [];

    if (activeRole === ROLE_ADMIN && selectedScheduleId) {
      const selectedResult = await db.collection('schedules').doc(selectedScheduleId).get();
      const selectedSchedule = selectedResult.data || null;

      if (selectedSchedule && String(selectedSchedule.date || '') >= today && selectedSchedule.shiftType !== SHIFT_TYPE_LEAVE) {
        leaderSchedules = [selectedSchedule];
      }
    }

    if (!leaderSchedules.length) {
      const leaderScheduleResult = await db.collection('schedules')
        .where({
          leaderUserId: requesterId,
          date: db.command.gte(today),
          shiftType: db.command.neq(SHIFT_TYPE_LEAVE),
        })
        .orderBy('date', 'asc')
        .orderBy('startTime', 'asc')
        .limit(100)
        .get();

      leaderSchedules = buildLeaderScheduleList(leaderScheduleResult.data || []);
    }

    const activeSchedule = selectActiveShift(leaderSchedules, selectedScheduleId, today, currentMinutes);

    if (!activeSchedule) {
      return {
        success: true,
        leaderSchedules: [],
        activeSchedule: null,
        roster: [],
        requester: omitPassword(requester),
      };
    }

    const rosterResult = await db.collection('schedules')
      .where(buildSlotMatcher(activeSchedule))
      .orderBy('userName', 'asc')
      .limit(100)
      .get();

    const rosterBase = (rosterResult.data || []).filter((item) => item.shiftType !== SHIFT_TYPE_LEAVE);
    const userIds = [...new Set(rosterBase.map((item) => item.userId).filter(Boolean))];
    const userMap = {};

    if (userIds.length > 0) {
      const userResult = await db.collection('users')
        .where({
          _id: db.command.in(userIds),
        })
        .field({
          _id: true,
          studentId: true,
        })
        .limit(100)
        .get();

      (userResult.data || []).forEach((user) => {
        userMap[user._id] = user;
      });
    }

    const roster = rosterBase.map((item) => ({
      ...item,
      studentId: userMap[item.userId] ? userMap[item.userId].studentId : '',
      leaderConfirmText: getLeaderConfirmText(item),
      leaderConfirmClass: getLeaderConfirmClass(item),
      participantTypeText: getParticipantTypeText(item),
      participantTypeClass: getParticipantTypeClass(item),
      overtimeText: getOvertimeText(item),
      overtimeClass: getOvertimeClass(item),
      canNormalizeAttendance: item.date === today && (
        item.attendanceStatus === ATTENDANCE_ABSENT
        || item.attendanceStatus === ATTENDANCE_MISSING_CHECKOUT
        || item.leaderConfirmStatus === 'absent'
      ),
      canConfirmPresent: item.date === today && Boolean(item.checkInTime) && item.leaderConfirmStatus !== 'present',
      canConfirmAbsent: item.date === today && !item.checkInTime && item.leaderConfirmStatus !== 'absent',
      canReviewOvertime: Boolean(item.checkOutTime) && item.overtimeStatus === 'pending' && Number(item.overtimeHours || 0) > 0,
    }));

    return {
      success: true,
      requester: omitPassword(requester),
      leaderSchedules,
      activeSchedule,
      roster,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
