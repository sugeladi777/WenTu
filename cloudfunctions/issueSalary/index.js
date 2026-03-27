const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];
const ATTENDANCE_NORMAL = 0;
const ATTENDANCE_LATE = 1;
const ATTENDANCE_ABSENT = 3;
const SHIFT_TYPE_LEAVE = 1;

function roundNumber(value) {
  return Math.round(Number(value || 0) * 100) / 100;
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
    throw new Error('只有管理员可以发放工资');
  }

  return user;
}

async function loadAllDocuments(collection, filter) {
  const pageSize = 100;
  const documents = [];
  let offset = 0;

  while (true) {
    const result = await collection.where(filter).orderBy('date', 'asc').skip(offset).limit(pageSize).get();
    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
}

function isValidSalarySchedule(schedule) {
  const isCompleted = Boolean(schedule && schedule.checkOutTime);
  const hasValidAttendance = schedule && (
    schedule.attendanceStatus === ATTENDANCE_NORMAL ||
    schedule.attendanceStatus === ATTENDANCE_LATE
  );

  return Boolean(
    schedule &&
    !schedule.salaryPaid &&
    isCompleted &&
    hasValidAttendance &&
    schedule.shiftType !== SHIFT_TYPE_LEAVE &&
    schedule.attendanceStatus !== ATTENDANCE_ABSENT,
  );
}

function getActualHours(schedule) {
  if (!isValidSalarySchedule({ ...schedule, salaryPaid: false })) {
    return 0;
  }

  const shiftHours = Number(schedule.fixedHours) || 0;
  const approvedOvertime = schedule.overtimeApproved ? (Number(schedule.overtimeHours) || 0) : 0;
  return roundNumber(shiftHours + approvedOvertime);
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const targetUserId = String(event.targetUserId || '').trim();
  const semesterId = String(event.semesterId || '').trim();
  const hourlyRate = roundNumber(event.hourlyRate);

  if (!requesterId || !targetUserId || !semesterId || !hourlyRate) {
    return { success: false, error: '参数错误' };
  }

  if (hourlyRate <= 0) {
    return { success: false, error: '每工时工资必须大于 0' };
  }

  try {
    const requester = await ensureAdmin(requesterId);
    const schedules = await loadAllDocuments(db.collection('schedules'), {
      userId: targetUserId,
      semesterId,
    });

    const payableSchedules = schedules.filter((schedule) => isValidSalarySchedule(schedule));
    if (!payableSchedules.length) {
      return { success: false, error: '当前没有可发放工资的班次' };
    }

    let totalHours = 0;
    let totalAmount = 0;

    for (const schedule of payableSchedules) {
      const actualHours = getActualHours(schedule);
      const salaryAmount = roundNumber(actualHours * hourlyRate);

      totalHours = roundNumber(totalHours + actualHours);
      totalAmount = roundNumber(totalAmount + salaryAmount);

      await db.collection('schedules').doc(schedule._id).update({
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
    }

    return {
      success: true,
      updatedCount: payableSchedules.length,
      totalHours,
      totalAmount,
      message: `已发放 ${payableSchedules.length} 个班次，共 ${totalAmount} 元`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
