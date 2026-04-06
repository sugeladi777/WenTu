const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];
const ATTENDANCE_NORMAL = 0;
const ATTENDANCE_LATE = 1;
const ATTENDANCE_MISSING_CHECKOUT = 2;
const ATTENDANCE_ABSENT = 3;
const SHIFT_TYPE_LEAVE = 1;

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

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !normalizeRoles(user).includes(ROLE_ADMIN)) {
    throw new Error('只有管理员可以批量发放工资');
  }

  return user;
}

async function loadAllDocuments(collection, filter = {}) {
  const pageSize = 100;
  const documents = [];
  let offset = 0;

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

function buildDateTimeValue(dateString, timeString) {
  const safeDate = String(dateString || '').trim();
  const safeTime = String(timeString || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate) || !/^\d{2}:\d{2}$/.test(safeTime)) {
    return Number.NaN;
  }

  return new Date(`${safeDate}T${safeTime}:00+08:00`).getTime();
}

function resolveRange(event = {}) {
  const startDate = String(event.startDate || '').trim();
  const startTime = String(event.startTime || '').trim();
  const endDate = String(event.endDate || '').trim();
  const endTime = String(event.endTime || '').trim();

  if (!startDate || !startTime || !endDate || !endTime) {
    throw new Error('请完整选择开始和结束时间');
  }

  const startValue = buildDateTimeValue(startDate, startTime);
  const endValue = buildDateTimeValue(endDate, endTime);

  if (Number.isNaN(startValue) || Number.isNaN(endValue)) {
    throw new Error('时间格式不正确');
  }

  if (startValue > endValue) {
    throw new Error('开始时间不能晚于结束时间');
  }

  return {
    startDate,
    startTime,
    endDate,
    endTime,
    startValue,
    endValue,
    label: `${startDate} ${startTime} - ${endDate} ${endTime}`,
  };
}

function scheduleOverlapsRange(schedule = {}, range) {
  const startValue = buildDateTimeValue(schedule.date, schedule.startTime || '00:00');
  const endValue = buildDateTimeValue(schedule.date, schedule.endTime || '23:59');

  if (Number.isNaN(startValue) || Number.isNaN(endValue)) {
    return false;
  }

  return endValue >= range.startValue && startValue <= range.endValue;
}

function getEffectiveAttendanceStatus(schedule = {}) {
  if (!schedule || schedule.shiftType === SHIFT_TYPE_LEAVE) {
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

function getActualHours(schedule) {
  const effectiveAttendanceStatus = getEffectiveAttendanceStatus(schedule);
  const isValid = Boolean(
    schedule
    && schedule.checkOutTime
    && (effectiveAttendanceStatus === ATTENDANCE_NORMAL || effectiveAttendanceStatus === ATTENDANCE_LATE)
    && schedule.shiftType !== SHIFT_TYPE_LEAVE
    && effectiveAttendanceStatus !== ATTENDANCE_ABSENT,
  );

  if (!isValid) {
    return 0;
  }

  const shiftHours = Number(schedule.fixedHours) || 0;
  const approvedOvertime = schedule.overtimeApproved ? (Number(schedule.overtimeHours) || 0) : 0;
  return roundNumber(shiftHours + approvedOvertime);
}

function isValidSalarySchedule(schedule) {
  return Boolean(schedule && !schedule.salaryPaid && getActualHours(schedule) > 0);
}

function isUpdateSuccessful(result) {
  return Number(result && result.stats && result.stats.updated) > 0;
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const hourlyRate = roundNumber(event.hourlyRate);

  if (!requesterId) {
    return { success: false, error: '请求用户不能为空' };
  }

  if (!hourlyRate || hourlyRate <= 0) {
    return { success: false, error: '请填写正确的每工时工资' };
  }

  try {
    const requester = await ensureAdmin(requesterId);
    const range = resolveRange(event);
    const schedules = await loadAllDocuments(db.collection('schedules'), {
      date: db.command.gte(range.startDate).and(db.command.lte(range.endDate)),
    });

    const payableSchedules = schedules.filter((schedule) => {
      return scheduleOverlapsRange(schedule, range) && isValidSalarySchedule(schedule);
    });

    if (!payableSchedules.length) {
      return { success: false, error: '所选时间段内没有待发薪的有效班次' };
    }

    const affectedUsers = new Set();
    let updatedCount = 0;
    let skippedCount = 0;
    let totalHours = 0;
    let totalAmount = 0;

    for (const schedule of payableSchedules) {
      const actualHours = getActualHours(schedule);
      const salaryAmount = roundNumber(actualHours * hourlyRate);

      const updateResult = await db.collection('schedules').where({
        _id: schedule._id,
        salaryPaid: false,
      }).update({
        data: {
          salaryPaid: true,
          salaryRate: hourlyRate,
          salaryAmount,
          salaryPaidAt: db.serverDate(),
          salaryPaidBy: requesterId,
          salaryPaidByName: requester.name || '',
          updatedAt: db.serverDate(),
        },
      });

      if (!isUpdateSuccessful(updateResult)) {
        skippedCount += 1;
        continue;
      }

      updatedCount += 1;
      totalHours = roundNumber(totalHours + actualHours);
      totalAmount = roundNumber(totalAmount + salaryAmount);
      affectedUsers.add(schedule.userId);
    }

    if (!updatedCount) {
      return { success: false, error: '这些班次刚刚已被其他管理员处理，请刷新后重试' };
    }

    return {
      success: true,
      updatedCount,
      skippedCount,
      affectedUserCount: affectedUsers.size,
      totalHours,
      totalAmount,
      rangeLabel: range.label,
      message: skippedCount > 0
        ? `已发放 ${updatedCount} 个班次，跳过 ${skippedCount} 个已处理班次，涉及 ${affectedUsers.size} 人，共 ${totalAmount} 元`
        : `已发放 ${updatedCount} 个班次，涉及 ${affectedUsers.size} 人，共 ${totalAmount} 元`,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};
