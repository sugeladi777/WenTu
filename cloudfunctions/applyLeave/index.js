const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_NORMAL = 0;
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

function hasScheduleStarted(schedule, today, currentMinutes) {
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

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const scheduleId = String(event.scheduleId || '').trim();
  const reason = String(event.reason || '').trim();

  if (!userId || !scheduleId) {
    return { success: false, error: '参数不完整' };
  }

  if (!reason) {
    return { success: false, error: '请填写请假原因' };
  }

  try {
    const scheduleResult = await db.collection('schedules').doc(scheduleId).get();
    const schedule = scheduleResult.data;

    if (!schedule) {
      return { success: false, error: '班次不存在' };
    }

    if (schedule.userId !== userId) {
      return { success: false, error: '只能申请自己的班次请假' };
    }

    if (schedule.shiftType !== SHIFT_TYPE_NORMAL) {
      return { success: false, error: '当前班次状态不支持再次请假' };
    }

    if (schedule.checkInTime || schedule.checkOutTime) {
      return { success: false, error: '该班次已产生考勤记录，不能申请请假' };
    }

    const now = getChinaParts();
    const today = formatChinaDate();
    const currentMinutes = now.hour * 60 + now.minute;

    if (hasScheduleStarted(schedule, today, currentMinutes)) {
      return { success: false, error: '只能对未开始的班次申请请假' };
    }

    await db.collection('schedules').doc(scheduleId).update({
      data: {
        shiftType: SHIFT_TYPE_LEAVE,
        leaveReason: reason,
        leaveStatus: LEAVE_STATUS_PENDING,
        leaveRequestedAt: db.serverDate(),
        leaveRequesterId: schedule.userId,
        leaveRequesterName: schedule.userName || '',
        replacementUserId: null,
        replacementUserName: '',
        replacementScheduleId: null,
        leaveApprovedAt: null,
        updatedAt: db.serverDate(),
      },
    });

    return {
      success: true,
      message: '请假已发布，其他同学现在可以认领替班',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
