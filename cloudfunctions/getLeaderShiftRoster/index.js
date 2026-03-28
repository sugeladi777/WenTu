const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];
const SHIFT_TYPE_LEAVE = 1;

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
    return '已确认到岗';
  }

  if (schedule.leaderConfirmStatus === 'absent') {
    return '已确认旷岗';
  }

  if (schedule.checkInTime) {
    return '成员已自助签到';
  }

  return '待确认';
}

function getLeaderConfirmClass(schedule) {
  if (schedule.leaderConfirmStatus === 'present') {
    return 'success';
  }

  if (schedule.leaderConfirmStatus === 'absent') {
    return 'danger';
  }

  if (schedule.checkInTime) {
    return 'primary';
  }

  return 'warning';
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

function selectActiveShift(leaderSchedules, selectedScheduleId, currentMinutes) {
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
    const start = timeToMinutes(item.startTime);
    const end = timeToMinutes(item.endTime);
    return start !== null && end !== null && currentMinutes >= start - 15 && currentMinutes <= end + 30;
  });

  if (currentShift) {
    return currentShift;
  }

  const upcoming = leaderSchedules.find((item) => {
    const start = timeToMinutes(item.startTime);
    return start !== null && currentMinutes < start;
  });

  return upcoming || leaderSchedules[0];
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
  const date = String(event.date || '').trim() || formatChinaDate();

  if (!requesterId) {
    return { success: false, error: '请求用户不能为空' };
  }

  try {
    const requester = await ensureRequester(requesterId);
    const now = toChinaDate();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    let leaderSchedules = [];

    if (hasRole(requester, ROLE_ADMIN) && selectedScheduleId) {
      const selectedResult = await db.collection('schedules').doc(selectedScheduleId).get();
      const selectedSchedule = selectedResult.data || null;

      if (selectedSchedule && selectedSchedule.date === date && selectedSchedule.shiftType !== SHIFT_TYPE_LEAVE) {
        leaderSchedules = [selectedSchedule];
      }
    }

    if (!leaderSchedules.length) {
      const leaderScheduleResult = await db.collection('schedules')
        .where({
          userId: requesterId,
          leaderUserId: requesterId,
          date,
          shiftType: db.command.neq(SHIFT_TYPE_LEAVE),
        })
        .orderBy('startTime', 'asc')
        .limit(50)
        .get();

      leaderSchedules = leaderScheduleResult.data || [];
    }

    const activeSchedule = selectActiveShift(leaderSchedules, selectedScheduleId, currentMinutes);

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
