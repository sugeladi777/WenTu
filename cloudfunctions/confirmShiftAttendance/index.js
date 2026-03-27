const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];
const SHIFT_TYPE_LEAVE = 1;
const ATTENDANCE_NORMAL = 0;
const ATTENDANCE_LATE = 1;
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

async function ensureLeaderOrAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || (!hasRole(user, ROLE_LEADER) && !hasRole(user, ROLE_ADMIN))) {
    throw new Error('只有班负或管理员可以执行该操作');
  }

  return user;
}

function evaluateAttendanceStatus(schedule, currentMinutes) {
  const startMinutes = timeToMinutes(schedule.startTime);
  if (startMinutes === null) {
    return ATTENDANCE_NORMAL;
  }

  return currentMinutes > startMinutes + 5 ? ATTENDANCE_LATE : ATTENDANCE_NORMAL;
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const requesterName = String(event.requesterName || '').trim();
  const scheduleId = String(event.scheduleId || '').trim();
  const action = String(event.action || '').trim();

  if (!requesterId || !scheduleId || !action) {
    return { success: false, error: '参数错误' };
  }

  if (!['present', 'absent'].includes(action)) {
    return { success: false, error: '不支持的确认动作' };
  }

  try {
    const requester = await ensureLeaderOrAdmin(requesterId);
    const targetResult = await db.collection('schedules').doc(scheduleId).get();
    const schedule = targetResult.data || null;

    if (!schedule) {
      return { success: false, error: '班次记录不存在' };
    }

    if (schedule.date !== formatChinaDate()) {
      return { success: false, error: '只能确认当天班次' };
    }

    if (schedule.shiftType === SHIFT_TYPE_LEAVE) {
      return { success: false, error: '请假班次不需要签到确认' };
    }

    const now = toChinaDate();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const startMinutes = timeToMinutes(schedule.startTime);
    const endMinutes = timeToMinutes(schedule.endTime);

    if (startMinutes === null || endMinutes === null) {
      return { success: false, error: '班次时间配置异常' };
    }

    if (currentMinutes < startMinutes - 15 || currentMinutes > endMinutes + 60) {
      return { success: false, error: '当前不在可确认的班次时间窗口内' };
    }

    if (!hasRole(requester, ROLE_ADMIN)) {
      const leaderSlotResult = await db.collection('schedules')
        .where({
          userId: requesterId,
          shiftType: db.command.neq(SHIFT_TYPE_LEAVE),
          ...buildSlotMatcher(schedule),
        })
        .limit(1)
        .get();

      if (!leaderSlotResult.data || leaderSlotResult.data.length === 0) {
        return { success: false, error: '你不是这个班次的班负，不能确认该班次成员' };
      }
    }

    const updateData = {
      leaderConfirmStatus: action,
      leaderConfirmedAt: db.serverDate(),
      leaderConfirmedBy: requesterId,
      leaderConfirmedByName: requesterName || requester.name || '',
      updatedAt: db.serverDate(),
    };

    if (action === 'present') {
      if (!schedule.checkInTime) {
        updateData.checkInTime = db.serverDate();
      }

      updateData.attendanceStatus = evaluateAttendanceStatus(schedule, currentMinutes);
    } else {
      if (schedule.checkInTime) {
        return { success: false, error: '该同学已经签到，不能再标记旷岗' };
      }

      updateData.attendanceStatus = ATTENDANCE_ABSENT;
    }

    await db.collection('schedules').doc(scheduleId).update({
      data: updateData,
    });

    return {
      success: true,
      message: action === 'present' ? '已确认为到岗' : '已标记为旷岗',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
