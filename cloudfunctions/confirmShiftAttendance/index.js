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

function buildChinaDateTime(dateString, timeString) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!dateMatch || !timeMatch) {
    return null;
  }

  return new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${timeMatch[1]}:${timeMatch[2]}:00+08:00`);
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

async function ensureRequester(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user) {
    throw new Error('请求用户不存在');
  }

  return user;
}

function buildNormalizedUpdateData(schedule, requesterId, requesterName, currentMinutes, endMinutes) {
  const updateData = {
    leaderConfirmStatus: 'present',
    leaderConfirmedAt: db.serverDate(),
    leaderConfirmedBy: requesterId,
    leaderConfirmedByName: requesterName,
    attendanceStatus: ATTENDANCE_NORMAL,
    updatedAt: db.serverDate(),
  };

  const correctionAfterCheckoutDeadline = endMinutes !== null && currentMinutes > endMinutes + 30;

  if (!schedule.checkInTime) {
    updateData.checkInTime = correctionAfterCheckoutDeadline
      ? (buildChinaDateTime(schedule.date, schedule.startTime) || db.serverDate())
      : db.serverDate();
  }

  if (!schedule.checkOutTime && (schedule.attendanceStatus === ATTENDANCE_MISSING_CHECKOUT || correctionAfterCheckoutDeadline)) {
    updateData.checkOutTime = buildChinaDateTime(schedule.date, schedule.endTime) || db.serverDate();
  }

  return updateData;
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const requesterName = String(event.requesterName || '').trim();
  const scheduleId = String(event.scheduleId || '').trim();
  const action = String(event.action || '').trim();

  if (!requesterId || !scheduleId || !action) {
    return { success: false, error: '参数错误' };
  }

  if (!['present', 'late', 'absent', 'normalize'].includes(action)) {
    return { success: false, error: '不支持的确认动作' };
  }

  try {
    const requester = await ensureRequester(requesterId);
    const targetResult = await db.collection('schedules').doc(scheduleId).get();
    const schedule = targetResult.data || null;

    if (!schedule) {
      return { success: false, error: '班次记录不存在' };
    }

    if (schedule.date !== formatChinaDate()) {
      return { success: false, error: '只能确认当天班次' };
    }

    if (schedule.shiftType === SHIFT_TYPE_LEAVE) {
      return { success: false, error: '请假班次无需签到确认' };
    }

    const now = toChinaDate();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const startMinutes = timeToMinutes(schedule.startTime);
    const endMinutes = timeToMinutes(schedule.endTime);

    if (startMinutes === null || endMinutes === null) {
      return { success: false, error: '班次时间配置异常' };
    }

    if (action !== 'normalize' && (currentMinutes < startMinutes - 15 || currentMinutes > endMinutes + 60)) {
      return { success: false, error: '当前不在可确认的班次时间窗口内' };
    }

    if (!hasRole(requester, ROLE_ADMIN)) {
      const leaderSlotResult = await db.collection('schedules')
        .where({
          leaderUserId: requesterId,
          shiftType: db.command.neq(SHIFT_TYPE_LEAVE),
          ...buildSlotMatcher(schedule),
        })
        .limit(1)
        .get();

      if (!leaderSlotResult.data || leaderSlotResult.data.length === 0) {
        return { success: false, error: '你不是这个班次的班负，不能确认该班次成员' };
      }
    }

    const normalizedRequesterName = requesterName || requester.name || '';
    let updateData = {
      leaderConfirmStatus: action,
      leaderConfirmedAt: db.serverDate(),
      leaderConfirmedBy: requesterId,
      leaderConfirmedByName: normalizedRequesterName,
      updatedAt: db.serverDate(),
    };

    if (action === 'present') {
      if (!schedule.checkInTime) {
        return { success: false, error: '该同学尚未自助签到，不能确认到岗' };
      }

      updateData.leaderConfirmStatus = 'present';
      updateData.attendanceStatus = ATTENDANCE_NORMAL;
    } else if (action === 'late') {
      if (!schedule.checkInTime) {
        return { success: false, error: '该同学尚未自助签到，不能标记迟到' };
      }

      updateData.leaderConfirmStatus = 'present';
      updateData.attendanceStatus = ATTENDANCE_LATE;
    } else if (action === 'normalize') {
      const hasAbnormalStatus = schedule.attendanceStatus === ATTENDANCE_ABSENT
        || schedule.attendanceStatus === ATTENDANCE_MISSING_CHECKOUT
        || schedule.attendanceStatus === ATTENDANCE_LATE
        || schedule.leaderConfirmStatus === 'absent';

      if (!hasAbnormalStatus) {
        return { success: false, error: '当前不是可恢复的异常状态' };
      }

      updateData = buildNormalizedUpdateData(
        schedule,
        requesterId,
        normalizedRequesterName,
        currentMinutes,
        endMinutes,
      );
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
      message: action === 'present'
        ? '已确认签到'
        : (action === 'late' ? '已标记为迟到' : (action === 'normalize' ? '已恢复为正常签到' : '已标记为旷岗')),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
