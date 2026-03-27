const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_LEAVE = 1;
const SHIFT_TYPE_SWAP = 2;
const LEAVE_STATUS_PENDING = 0;
const LEAVE_STATUS_APPROVED = 1;

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

function hasShiftStarted(schedule, today, currentMinutes) {
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

function hasTimeConflict(candidate, existing) {
  if (!candidate || !existing || candidate.date !== existing.date) {
    return false;
  }

  const candidateStart = timeToMinutes(candidate.startTime);
  const candidateEnd = timeToMinutes(candidate.endTime);
  const existingStart = timeToMinutes(existing.startTime);
  const existingEnd = timeToMinutes(existing.endTime);

  if ([candidateStart, candidateEnd, existingStart, existingEnd].some((value) => value === null)) {
    return false;
  }

  return candidateStart < existingEnd && candidateEnd > existingStart;
}

function buildReplacementSchedule(leaveSchedule, userId, userName) {
  return {
    semesterId: leaveSchedule.semesterId,
    userId,
    userName,
    date: leaveSchedule.date,
    dayOfWeek: leaveSchedule.dayOfWeek,
    shiftId: leaveSchedule.shiftId,
    shiftName: leaveSchedule.shiftName,
    startTime: leaveSchedule.startTime,
    endTime: leaveSchedule.endTime,
    fixedHours: Number(leaveSchedule.fixedHours) || 0,
    shiftType: SHIFT_TYPE_SWAP,
    checkInTime: null,
    checkOutTime: null,
    attendanceStatus: null,
    overtimeHours: 0,
    overtimeApproved: false,
    leaveReason: '',
    leaveStatus: null,
    leaveApprovedBy: null,
    leaveApprovedAt: null,
    originalUserId: leaveSchedule.userId,
    originalUserName: leaveSchedule.userName || '',
    relatedLeaveScheduleId: leaveSchedule._id,
    leaderConfirmStatus: null,
    leaderConfirmedAt: null,
    leaderConfirmedBy: null,
    leaderConfirmedByName: '',
    salaryPaid: false,
    salaryWeek: null,
    salaryAmount: null,
    salaryPaidAt: null,
    salaryPaidBy: null,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };
}

async function loadAllDocuments(collection, filter) {
  const documents = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const result = await collection
      .where(filter)
      .orderBy('date', 'asc')
      .skip(offset)
      .limit(pageSize)
      .get();

    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const userName = String(event.userName || '').trim();
  const scheduleId = String(event.scheduleId || '').trim();

  if (!userId || !userName || !scheduleId) {
    return { success: false, error: '参数错误' };
  }

  try {
    const leaveScheduleResult = await db.collection('schedules').doc(scheduleId).get();
    const leaveSchedule = leaveScheduleResult.data;

    if (!leaveSchedule) {
      return { success: false, error: '请假班次不存在' };
    }

    if (leaveSchedule.userId === userId) {
      return { success: false, error: '不能认领自己的请假班次' };
    }

    if (leaveSchedule.shiftType !== SHIFT_TYPE_LEAVE || leaveSchedule.leaveStatus !== LEAVE_STATUS_PENDING) {
      return { success: false, error: '该班次当前不可替班' };
    }

    if (leaveSchedule.replacementScheduleId || leaveSchedule.replacementUserId) {
      return { success: false, error: '该班次已经被其他同学认领了' };
    }

    if (leaveSchedule.checkInTime || leaveSchedule.checkOutTime) {
      return { success: false, error: '该班次已产生考勤记录，不能再替班' };
    }

    const now = getChinaParts();
    const today = formatChinaDate();
    const currentMinutes = now.hour * 60 + now.minute;

    if (hasShiftStarted(leaveSchedule, today, currentMinutes)) {
      return { success: false, error: '只能认领尚未开始的班次' };
    }

    const mySchedules = await loadAllDocuments(db.collection('schedules'), {
      userId,
      date: db.command.gte(today),
      ...(leaveSchedule.semesterId ? { semesterId: leaveSchedule.semesterId } : {}),
    });

    if (mySchedules.some((schedule) => hasTimeConflict(leaveSchedule, schedule))) {
      return { success: false, error: '你在该时间段已经有其他班次，无法替班' };
    }

    const replacementResult = await db.collection('schedules').add({
      data: buildReplacementSchedule(leaveSchedule, userId, userName),
    });

    await db.collection('schedules').doc(scheduleId).update({
      data: {
        leaveStatus: LEAVE_STATUS_APPROVED,
        replacementUserId: userId,
        replacementUserName: userName,
        replacementScheduleId: replacementResult._id,
        leaveApprovedAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });

    return {
      success: true,
      message: '替班认领成功',
      replacementScheduleId: replacementResult._id,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
