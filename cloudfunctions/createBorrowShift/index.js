const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_BORROW = 3;

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

function parseDateString(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
  if (!match) {
    return null;
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
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

function buildSlotKey(record) {
  if (record.shiftId) {
    return String(record.shiftId);
  }

  return `${record.startTime || ''}::${record.endTime || ''}`;
}

function hasTimeConflict(template, schedule) {
  if (!template || !schedule) {
    return false;
  }

  const templateStart = timeToMinutes(template.startTime);
  const templateEnd = timeToMinutes(template.endTime);
  const scheduleStart = timeToMinutes(schedule.startTime);
  const scheduleEnd = timeToMinutes(schedule.endTime);

  if (
    templateStart === null
    || templateEnd === null
    || scheduleStart === null
    || scheduleEnd === null
  ) {
    return false;
  }

  return templateStart < scheduleEnd && scheduleStart < templateEnd;
}

function getDayOfWeek(dateString) {
  const date = parseDateString(dateString);
  if (!date) {
    return null;
  }

  const rawDay = date.getDay();
  return rawDay === 0 ? 6 : rawDay - 1;
}

async function loadAllDocuments(collection, filter) {
  const documents = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const result = await collection.where(filter).skip(offset).limit(pageSize).get();
    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
}

function buildBorrowSchedule({ semesterId, userId, userName, date, dayOfWeek, template, leaderInfo }) {
  return {
    semesterId,
    userId,
    userName,
    date,
    dayOfWeek,
    shiftId: template._id,
    shiftName: template.name,
    startTime: template.startTime,
    endTime: template.endTime,
    fixedHours: Number(template.fixedHours) || 0,
    shiftType: SHIFT_TYPE_BORROW,
    checkInTime: null,
    checkOutTime: null,
    attendanceStatus: null,
    overtimeHours: 0,
    overtimeApproved: false,
    overtimeStatus: '',
    overtimeRequestedAt: null,
    overtimeReviewedAt: null,
    overtimeReviewedBy: null,
    overtimeReviewedByName: '',
    leaveReason: '',
    leaveStatus: null,
    leaveApprovedBy: null,
    leaveApprovedAt: null,
    originalUserId: null,
    originalUserName: '',
    leaderUserId: leaderInfo.leaderUserId || null,
    leaderUserName: leaderInfo.leaderUserName || '',
    leaderConfirmStatus: null,
    leaderConfirmedAt: null,
    leaderConfirmedBy: null,
    leaderConfirmedByName: '',
    salaryPaid: false,
    salaryWeek: null,
    salaryAmount: null,
    salaryPaidAt: null,
    salaryPaidBy: null,
    borrowCreatedAt: db.serverDate(),
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const semesterId = String(event.semesterId || '').trim();
  const date = String(event.date || '').trim();
  const shiftId = String(event.shiftId || '').trim();

  if (!userId || !semesterId || !date || !shiftId) {
    return { success: false, error: '参数错误' };
  }

  try {
    const [userResult, semesterResult, templateResult] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('semesters').doc(semesterId).get(),
      db.collection('shiftTemplates').doc(shiftId).get(),
    ]);

    const user = userResult.data || null;
    const semester = semesterResult.data || null;
    const template = templateResult.data || null;

    if (!user) {
      return { success: false, error: '用户不存在' };
    }

    if (!semester) {
      return { success: false, error: '学期不存在' };
    }

    if (!template || String(template.semesterId || '').trim() !== semesterId) {
      return { success: false, error: '班次模板不存在' };
    }

    if (date < String(semester.startDate || '') || date > String(semester.endDate || '')) {
      return { success: false, error: '日期不在学期范围内' };
    }

    const today = formatChinaDate();
    const nowParts = getChinaParts();
    const currentMinutes = nowParts.hour * 60 + nowParts.minute;

    if (hasShiftStarted({
      date,
      startTime: template.startTime,
    }, today, currentMinutes)) {
      return { success: false, error: '只能添加尚未开始的班次' };
    }

    const [mySchedules, slotSchedules] = await Promise.all([
      loadAllDocuments(db.collection('schedules'), { semesterId, userId, date }),
      loadAllDocuments(db.collection('schedules'), { semesterId, date, shiftId }),
    ]);

    const sameSlotSchedule = mySchedules.find((item) => buildSlotKey(item) === shiftId);
    if (sameSlotSchedule) {
      return { success: false, error: '该班次已在你的班次列表中' };
    }

    const conflictSchedule = mySchedules.find((item) => hasTimeConflict(template, item));
    if (conflictSchedule) {
      return { success: false, error: '该班次与你现有班次时间冲突' };
    }

    const leaderSchedule = slotSchedules.find((item) => String(item.leaderUserId || '').trim()) || null;
    const leaderInfo = {
      leaderUserId: leaderSchedule ? String(leaderSchedule.leaderUserId || '').trim() : '',
      leaderUserName: leaderSchedule ? String(leaderSchedule.leaderUserName || '').trim() : '',
    };
    const dayOfWeek = getDayOfWeek(date);

    const schedule = buildBorrowSchedule({
      semesterId,
      userId,
      userName: String(user.name || '').trim(),
      date,
      dayOfWeek,
      template,
      leaderInfo,
    });

    const createResult = await db.collection('schedules').add({
      data: schedule,
    });

    return {
      success: true,
      message: '蹭班已加入我的班次',
      scheduleId: createResult._id,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
