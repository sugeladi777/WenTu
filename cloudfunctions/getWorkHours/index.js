const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ATTENDANCE_NORMAL = 0;
const ATTENDANCE_LATE = 1;
const ATTENDANCE_MISSING_CHECKOUT = 2;
const ATTENDANCE_ABSENT = 3;
const SHIFT_TYPE_LEAVE = 1;
const SHIFT_TYPE_SWAP = 2;

async function loadAllDocuments(collection, filter) {
  const pageSize = 100;
  const documents = [];
  let offset = 0;

  while (true) {
    const result = await collection.where(filter).orderBy('date', 'desc').skip(offset).limit(pageSize).get();
    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
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

async function attachLeaveCountMeta(schedules = []) {
  const replacementScheduleMap = await loadReplacementScheduleMap(schedules);

  return schedules.map((schedule) => {
    if (Number(schedule.shiftType) !== SHIFT_TYPE_LEAVE) {
      return schedule;
    }

    return {
      ...schedule,
      leaveCountsAsLeave: shouldCountAsLeave(schedule, replacementScheduleMap),
    };
  });
}

function roundNumber(value) {
  return Math.round(Number(value || 0) * 100) / 100;
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

function sortSchedules(schedules) {
  return schedules.slice().sort((left, right) => {
    if (left.date !== right.date) {
      return String(right.date || '').localeCompare(String(left.date || ''));
    }

    return String(left.startTime || '').localeCompare(String(right.startTime || ''));
  });
}

function buildWorkHourItem(schedule) {
  const effectiveAttendanceStatus = getEffectiveAttendanceStatus(schedule);
  const isValid = Boolean(
    schedule.checkOutTime
    && (effectiveAttendanceStatus === ATTENDANCE_NORMAL || effectiveAttendanceStatus === ATTENDANCE_LATE)
    && Number(schedule.shiftType) !== SHIFT_TYPE_LEAVE
    && effectiveAttendanceStatus !== ATTENDANCE_ABSENT,
  );
  const shiftHours = isValid ? (Number(schedule.fixedHours) || 0) : 0;
  const approvedOvertimeHours = isValid && schedule.overtimeApproved
    ? (Number(schedule.overtimeHours) || 0)
    : 0;
  const actualHours = roundNumber(shiftHours + approvedOvertimeHours);
  const salaryAmount = schedule.salaryPaid ? roundNumber(schedule.salaryAmount || 0) : 0;

  return {
    ...schedule,
    attendanceStatus: effectiveAttendanceStatus,
    effectiveAttendanceStatus,
    shiftHours,
    overtimeHours: Number(schedule.overtimeHours) || 0,
    approvedOvertimeHours,
    actualHours,
    hours: actualHours,
    isValid,
    isPaid: Boolean(schedule.salaryPaid),
    salaryAmount,
  };
}

function summarizeItems(items) {
  let totalHours = 0;
  let totalPaidAmount = 0;
  let paidHours = 0;
  let unpaidHours = 0;
  let validCount = 0;
  let paidCount = 0;
  let unpaidCount = 0;

  items.forEach((item) => {
    if (!item.isValid) {
      return;
    }

    validCount += 1;
    totalHours += item.actualHours;

    if (item.isPaid) {
      paidCount += 1;
      paidHours += item.actualHours;
      totalPaidAmount += item.salaryAmount;
      return;
    }

    unpaidCount += 1;
    unpaidHours += item.actualHours;
  });

  return {
    totalHours: roundNumber(totalHours),
    totalPaidAmount: roundNumber(totalPaidAmount),
    paidHours: roundNumber(paidHours),
    unpaidHours: roundNumber(unpaidHours),
    validCount,
    paidCount,
    unpaidCount,
  };
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const startDate = String(event.startDate || '').trim();
  const endDate = String(event.endDate || '').trim();
  const semesterId = String(event.semesterId || '').trim();

  if (!userId) {
    return { success: false, error: '用户 ID 不能为空' };
  }

  try {
    const rangeQuery = { userId };

    if (startDate && endDate) {
      rangeQuery.date = db.command.gte(startDate).and(db.command.lte(endDate));
    }

    if (semesterId) {
      rangeQuery.semesterId = semesterId;
    }

    const rangeSchedules = sortSchedules(await attachLeaveCountMeta(
      await loadAllDocuments(db.collection('schedules'), rangeQuery)
    ));
    const rangeItems = rangeSchedules.map(buildWorkHourItem);
    const rangeSummary = summarizeItems(rangeItems);

    let semesterSummary = null;

    if (semesterId) {
      const semesterSchedules = sortSchedules(await attachLeaveCountMeta(
        await loadAllDocuments(db.collection('schedules'), {
          userId,
          semesterId,
        })
      ));
      semesterSummary = summarizeItems(semesterSchedules.map(buildWorkHourItem));
    }

    return {
      success: true,
      totalHours: rangeSummary.totalHours,
      totalPaidAmount: rangeSummary.totalPaidAmount,
      paidHours: rangeSummary.paidHours,
      unpaidHours: rangeSummary.unpaidHours,
      validCount: rangeSummary.validCount,
      paidCount: rangeSummary.paidCount,
      unpaidCount: rangeSummary.unpaidCount,
      list: rangeItems,
      count: rangeItems.length,
      rangeSummary,
      semesterSummary,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
