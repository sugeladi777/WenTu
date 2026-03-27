const { ATTENDANCE_STATUS, LEAVE_STATUS, SHIFT_TYPE } = require('./constants');
const {
  compareDateString,
  formatDate,
  formatDateTime,
  formatTime,
  getDayIndex,
  getWeekDates,
} = require('./date');

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function getEffectiveAttendanceStatus(schedule = {}, now = new Date()) {
  if (!schedule || schedule.shiftType === SHIFT_TYPE.LEAVE) {
    return schedule ? schedule.attendanceStatus : null;
  }

  if (schedule.attendanceStatus === ATTENDANCE_STATUS.ABSENT) {
    return ATTENDANCE_STATUS.ABSENT;
  }

  if (schedule.attendanceStatus === ATTENDANCE_STATUS.MISSING_CHECKOUT) {
    return ATTENDANCE_STATUS.MISSING_CHECKOUT;
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

  const today = formatDate(now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const cutoffPassed = schedule.date < today || (schedule.date === today && currentMinutes > endMinutes + 30);

  if (!cutoffPassed) {
    return schedule.attendanceStatus;
  }

  if (!schedule.checkInTime) {
    return ATTENDANCE_STATUS.ABSENT;
  }

  return ATTENDANCE_STATUS.MISSING_CHECKOUT;
}

function getShiftTypeText(shiftType) {
  switch (shiftType) {
    case SHIFT_TYPE.LEAVE:
      return '请假';
    case SHIFT_TYPE.SWAP:
      return '替班';
    case SHIFT_TYPE.BORROW:
      return '借班';
    default:
      return '正常';
  }
}

function getShiftTypeClass(shiftType) {
  switch (shiftType) {
    case SHIFT_TYPE.LEAVE:
      return 'shift-leave';
    case SHIFT_TYPE.SWAP:
      return 'shift-swap';
    case SHIFT_TYPE.BORROW:
      return 'shift-borrow';
    default:
      return '';
  }
}

function getLeaveProgressMeta(schedule = {}) {
  if (schedule.shiftType !== SHIFT_TYPE.LEAVE) {
    return { text: '', className: '' };
  }

  if (schedule.leaveStatus === LEAVE_STATUS.APPROVED) {
    return {
      text: schedule.replacementUserName
        ? `已由 ${schedule.replacementUserName} 替班`
        : '已请假',
      className: 'text-muted',
    };
  }

  return { text: '待人替班', className: 'text-warning' };
}

function getAttendanceMeta(schedule = {}) {
  const effectiveStatus = getEffectiveAttendanceStatus(schedule);

  if (schedule.shiftType === SHIFT_TYPE.LEAVE) {
    if (schedule.leaveStatus === LEAVE_STATUS.APPROVED) {
      return { text: '已请假', className: 'text-muted' };
    }

    return { text: '待替班', className: 'text-warning' };
  }

  if (effectiveStatus === ATTENDANCE_STATUS.ABSENT) {
    return { text: '旷岗', className: 'text-danger' };
  }

  if (!schedule.checkInTime) {
    return { text: '未签到', className: 'text-muted' };
  }

  if (effectiveStatus === ATTENDANCE_STATUS.MISSING_CHECKOUT) {
    return { text: '未签退', className: 'text-warning' };
  }

  if (!schedule.checkOutTime) {
    return schedule.attendanceStatus === ATTENDANCE_STATUS.LATE
      ? { text: '已签到 / 迟到', className: 'text-warning' }
      : { text: '已签到', className: 'text-primary' };
  }

  if (effectiveStatus === ATTENDANCE_STATUS.LATE) {
    return { text: '迟到', className: 'text-warning' };
  }

  return { text: '正常', className: 'text-success' };
}

function getShiftKey(schedule = {}) {
  return [schedule.date, schedule.shiftId, schedule.startTime, schedule.endTime].join('::');
}

function decorateSchedule(schedule = {}) {
  const attendance = getAttendanceMeta(schedule);
  const leaveProgress = getLeaveProgressMeta(schedule);
  const salaryAmount = roundMoney(schedule.salaryAmount || 0);
  const effectiveAttendanceStatus = getEffectiveAttendanceStatus(schedule);

  return {
    ...schedule,
    effectiveAttendanceStatus,
    shiftTypeText: getShiftTypeText(schedule.shiftType),
    shiftTypeClass: getShiftTypeClass(schedule.shiftType),
    attendanceText: attendance.text,
    attendanceClass: attendance.className,
    leaveProgressText: leaveProgress.text,
    leaveProgressClass: leaveProgress.className,
    checkInTimeLabel: formatDateTime(schedule.checkInTime),
    checkOutTimeLabel: formatDateTime(schedule.checkOutTime),
    checkInTimeShort: formatTime(schedule.checkInTime),
    checkOutTimeShort: formatTime(schedule.checkOutTime),
    salaryPaidText: schedule.salaryPaid ? '工资已发放' : '工资待发放',
    salaryAmountDisplay: salaryAmount.toFixed(2),
    salaryPaidAtLabel: formatDateTime(schedule.salaryPaidAt),
    displayDate: schedule.date || '',
    shiftKey: getShiftKey(schedule),
  };
}

function pickCurrentShift(schedules = []) {
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return null;
  }

  const pendingCheckedOut = schedules.find((item) => {
    return item.checkInTime
      && !item.checkOutTime
      && getEffectiveAttendanceStatus(item) !== ATTENDANCE_STATUS.MISSING_CHECKOUT;
  });
  if (pendingCheckedOut) {
    return pendingCheckedOut;
  }

  const notCheckedIn = schedules.find((item) => {
    return item.shiftType !== SHIFT_TYPE.LEAVE
      && !item.checkInTime
      && getEffectiveAttendanceStatus(item) !== ATTENDANCE_STATUS.ABSENT;
  });
  if (notCheckedIn) {
    return notCheckedIn;
  }

  const leaveShift = schedules.find((item) => item.shiftType === SHIFT_TYPE.LEAVE);
  if (leaveShift) {
    return leaveShift;
  }

  return schedules[0];
}

function buildWeeklyCalendarData(shifts = []) {
  const sortedShifts = [...shifts].sort((left, right) => {
    const dateCompare = compareDateString(left.date, right.date);
    if (dateCompare !== 0) {
      return dateCompare;
    }

    return String(left.startTime || '').localeCompare(String(right.startTime || ''));
  });

  const weekMap = {};

  sortedShifts.forEach((shift) => {
    const weekDates = getWeekDates(shift.date);
    const weekKey = weekDates[0].raw;

    if (!weekMap[weekKey]) {
      weekMap[weekKey] = {
        weekStart: weekDates[0].raw,
        weekEnd: weekDates[weekDates.length - 1].raw,
        dates: weekDates.map((item) => item.label),
        days: [[], [], [], [], [], [], []],
      };
    }

    const dayIndex = getDayIndex(shift.date);
    weekMap[weekKey].days[dayIndex].push(decorateSchedule(shift));
  });

  return Object.keys(weekMap)
    .sort(compareDateString)
    .map((weekKey) => weekMap[weekKey]);
}

module.exports = {
  buildWeeklyCalendarData,
  decorateSchedule,
  getAttendanceMeta,
  getEffectiveAttendanceStatus,
  getLeaveProgressMeta,
  getShiftKey,
  getShiftTypeClass,
  getShiftTypeText,
  pickCurrentShift,
};
