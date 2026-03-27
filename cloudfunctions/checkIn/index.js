const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_LEAVE = 1;
const ATTENDANCE_NORMAL = 0;
const ATTENDANCE_LATE = 1;
const ATTENDANCE_ABSENT = 3;

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function toChinaDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const offsetMinutes = 8 * 60 + date.getTimezoneOffset();
  return new Date(date.getTime() + offsetMinutes * 60 * 1000);
}

function getChinaDateParts(input = new Date()) {
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
  const parts = getChinaDateParts(input);
  return `${parts.year}-${padNumber(parts.month)}-${padNumber(parts.day)}`;
}

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinutes(minutes) {
  const safeMinutes = Math.max(0, minutes);
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  return `${padNumber(hour)}:${padNumber(minute)}`;
}

function evaluateSchedule(schedule, currentMinutes) {
  if (!schedule) {
    return { ok: false, code: 'not_found', message: '班次不存在' };
  }

  if (schedule.checkInTime) {
    return { ok: false, code: 'checked_in', message: '该班次已经签到' };
  }

  if (schedule.attendanceStatus === ATTENDANCE_ABSENT) {
    return { ok: false, code: 'absent', message: '该班次已被标记为旷工' };
  }

  if (schedule.shiftType === SHIFT_TYPE_LEAVE) {
    return { ok: false, code: 'leave', message: '该班次已请假，不能签到' };
  }

  const startMinutes = timeToMinutes(schedule.startTime);
  const endMinutes = timeToMinutes(schedule.endTime);

  if (startMinutes === null || endMinutes === null) {
    return { ok: false, code: 'invalid_time', message: '班次时间配置异常' };
  }

  const earliestCheckIn = startMinutes - 15;
  if (currentMinutes < earliestCheckIn) {
    return {
      ok: false,
      code: 'too_early',
      message: `请在 ${formatMinutes(earliestCheckIn)} 后签到`,
      availableAt: earliestCheckIn,
    };
  }

  if (currentMinutes > endMinutes) {
    return { ok: false, code: 'expired', message: '已超过班次时间，不能签到' };
  }

  return {
    ok: true,
    attendanceStatus: currentMinutes > startMinutes + 5 ? ATTENDANCE_LATE : ATTENDANCE_NORMAL,
  };
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
  const latitude = typeof event.latitude === 'number' ? event.latitude : null;
  const longitude = typeof event.longitude === 'number' ? event.longitude : null;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const nowParts = getChinaDateParts();
    const currentMinutes = nowParts.hour * 60 + nowParts.minute;
    let targetSchedule = null;
    let evaluation = null;

    if (scheduleId) {
      const scheduleResult = await db.collection('schedules').doc(scheduleId).get();
      targetSchedule = scheduleResult.data;

      if (!targetSchedule || targetSchedule.userId !== userId) {
        return { success: false, error: '找不到可签到的班次' };
      }

      if (targetSchedule.date !== date) {
        return { success: false, error: '只能签到当天班次' };
      }

      evaluation = evaluateSchedule(targetSchedule, currentMinutes);
    } else {
      const scheduleList = await findTodaySchedules(userId, date);

      if (scheduleList.length === 0) {
        return { success: false, error: '今日没有班次' };
      }

      let nearestAvailableAt = null;
      let expiredCount = 0;

      for (const schedule of scheduleList) {
        const currentEvaluation = evaluateSchedule(schedule, currentMinutes);
        if (currentEvaluation.ok) {
          targetSchedule = schedule;
          evaluation = currentEvaluation;
          break;
        }

        if (currentEvaluation.code === 'too_early') {
          nearestAvailableAt = nearestAvailableAt === null
            ? currentEvaluation.availableAt
            : Math.min(nearestAvailableAt, currentEvaluation.availableAt);
        }

        if (currentEvaluation.code === 'expired') {
          expiredCount += 1;
        }
      }

      if (!targetSchedule) {
        if (nearestAvailableAt !== null) {
          return { success: false, error: `请在 ${formatMinutes(nearestAvailableAt)} 后签到` };
        }

        if (expiredCount > 0) {
          return { success: false, error: '已超过班次时间，不能签到' };
        }

        return { success: false, error: '今日班次已处理完成' };
      }
    }

    if (!evaluation || !evaluation.ok) {
      return { success: false, error: evaluation ? evaluation.message : '签到失败' };
    }

    await db.collection('schedules').doc(targetSchedule._id).update({
      data: {
        checkInTime: db.serverDate(),
        attendanceStatus: evaluation.attendanceStatus,
        checkInLocation: latitude !== null && longitude !== null ? { latitude, longitude } : null,
        updatedAt: db.serverDate(),
      },
    });

    return {
      success: true,
      scheduleId: targetSchedule._id,
      attendanceStatus: evaluation.attendanceStatus,
      status: evaluation.attendanceStatus === ATTENDANCE_LATE ? '签到成功（迟到）' : '签到成功',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
