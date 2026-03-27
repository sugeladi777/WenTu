const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ATTENDANCE_MISSING_CHECKOUT = 2;
const ATTENDANCE_ABSENT = 3;
const SHIFT_TYPE_LEAVE = 1;

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

async function loadPendingSchedules(today) {
  const schedules = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const result = await db.collection('schedules')
      .where({
        date: db.command.lte(today),
        checkOutTime: null,
      })
      .orderBy('date', 'asc')
      .skip(offset)
      .limit(pageSize)
      .get();

    const currentPage = result.data || [];
    schedules.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return schedules;
}

exports.main = async () => {
  try {
    const now = getChinaParts();
    const today = formatChinaDate();
    const currentMinutes = now.hour * 60 + now.minute;
    const schedules = await loadPendingSchedules(today);
    let updatedCount = 0;

    for (const schedule of schedules) {
      if (schedule.shiftType === SHIFT_TYPE_LEAVE) {
        continue;
      }

      const endMinutes = timeToMinutes(schedule.endTime);
      if (endMinutes === null) {
        continue;
      }

      const cutoffPassed = schedule.date < today || currentMinutes > endMinutes + 30;
      if (!cutoffPassed) {
        continue;
      }

      const nextAttendanceStatus = schedule.checkInTime
        ? ATTENDANCE_MISSING_CHECKOUT
        : ATTENDANCE_ABSENT;

      if (schedule.attendanceStatus === nextAttendanceStatus) {
        continue;
      }

      await db.collection('schedules').doc(schedule._id).update({
        data: {
          attendanceStatus: nextAttendanceStatus,
          updatedAt: db.serverDate(),
        },
      });
      updatedCount += 1;
    }

    return {
      success: true,
      message: `已更新 ${updatedCount} 条考勤记录`,
      updatedCount,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
