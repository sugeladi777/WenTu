const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ATTENDANCE_MISSING_CHECKOUT = 2;
const ATTENDANCE_ABSENT = 3;

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

function sanitizeOvertimeHours(value) {
  const hours = Number(value);
  if (Number.isNaN(hours) || hours < 0) {
    return 0;
  }

  return Math.round(hours * 100) / 100;
}

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

async function findTodaySchedules(userId, date) {
  const result = await db.collection('schedules')
    .where({ userId, date })
    .orderBy('startTime', 'asc')
    .limit(100)
    .get();

  return result.data || [];
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const date = String(event.date || '').trim() || formatChinaDate();
  const scheduleId = String(event.scheduleId || '').trim();
  const overtimeHours = sanitizeOvertimeHours(event.overtimeHours);

  if (!userId) {
    return { success: false, error: '用户 ID 不能为空' };
  }

  try {
    let targetSchedule = null;

    if (scheduleId) {
      const scheduleResult = await db.collection('schedules').doc(scheduleId).get();
      targetSchedule = scheduleResult.data;

      if (!targetSchedule || targetSchedule.userId !== userId) {
        return { success: false, error: '找不到可签退的班次' };
      }

      if (targetSchedule.date !== date) {
        return { success: false, error: '只能签退当天班次' };
      }
    } else {
      const schedules = await findTodaySchedules(userId, date);

      if (schedules.length === 0) {
        return { success: false, error: '今日没有班次' };
      }

      targetSchedule = schedules.find((item) => item.checkInTime && !item.checkOutTime) || null;
    }

    if (!targetSchedule) {
      return { success: false, error: '今日已全部签退' };
    }

    if (!targetSchedule.checkInTime) {
      return { success: false, error: '该班次尚未签到' };
    }

    if (targetSchedule.attendanceStatus === ATTENDANCE_ABSENT) {
      return { success: false, error: '该班次已记为旷岗' };
    }

    if (targetSchedule.attendanceStatus === ATTENDANCE_MISSING_CHECKOUT) {
      return { success: false, error: '该班次已记为未签退' };
    }

    if (targetSchedule.checkOutTime) {
      return { success: false, error: '该班次已签退' };
    }

    const now = getChinaParts();
    const currentMinutes = now.hour * 60 + now.minute;
    const endMinutes = timeToMinutes(targetSchedule.endTime);

    if (endMinutes === null) {
      return { success: false, error: '班次结束时间配置异常' };
    }

    if (currentMinutes < endMinutes) {
      return { success: false, error: '班次结束前不可签退' };
    }

    if (currentMinutes > endMinutes + 30) {
      await db.collection('schedules').doc(targetSchedule._id).update({
        data: {
          attendanceStatus: ATTENDANCE_MISSING_CHECKOUT,
          updatedAt: db.serverDate(),
        },
      });

      return { success: false, error: '已超过签退时限，该班次记为未签退' };
    }

    await db.collection('schedules').doc(targetSchedule._id).update({
      data: {
        checkOutTime: db.serverDate(),
        overtimeHours,
        overtimeApproved: false,
        updatedAt: db.serverDate(),
      },
    });

    return {
      success: true,
      message: '签退成功',
      scheduleId: targetSchedule._id,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
