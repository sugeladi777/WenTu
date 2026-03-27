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
const SHIFT_TYPE_SWAP = 2;

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

function hasRole(user, role) {
  return normalizeRoles(user).includes(role);
}

function getPrimaryRole(roles) {
  if (roles.includes(ROLE_ADMIN)) {
    return ROLE_ADMIN;
  }

  if (roles.includes(ROLE_LEADER)) {
    return ROLE_LEADER;
  }

  return ROLE_MEMBER;
}

function omitPassword(user) {
  if (!user) {
    return null;
  }

  const { password, ...userInfo } = user;
  const roles = normalizeRoles(user);
  const primaryRole = getPrimaryRole(roles);

  return {
    ...userInfo,
    roles,
    role: primaryRole,
    primaryRole,
  };
}

async function loadAllDocuments(collection, filter = {}, options = {}) {
  const documents = [];
  const pageSize = options.pageSize || 100;
  let offset = 0;

  while (true) {
    let query = collection.where(filter);

    if (options.field) {
      query = query.field(options.field);
    }

    if (options.orderByField) {
      query = query.orderBy(options.orderByField, options.orderByOrder || 'asc');
    }

    query = query.skip(offset).limit(pageSize);

    const result = await query.get();
    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
}

async function findSemester(semesterId) {
  if (semesterId) {
    const result = await db.collection('semesters').doc(semesterId).get();
    return result.data || null;
  }

  const today = formatChinaDate();
  const activeResult = await db.collection('semesters')
    .where({
      status: 'active',
      startDate: db.command.lte(today),
      endDate: db.command.gte(today),
    })
    .orderBy('startDate', 'desc')
    .limit(1)
    .get();

  if (activeResult.data && activeResult.data[0]) {
    return activeResult.data[0];
  }

  const latestResult = await db.collection('semesters')
    .where({ status: 'active' })
    .orderBy('startDate', 'desc')
    .limit(1)
    .get();

  return latestResult.data && latestResult.data[0] ? latestResult.data[0] : null;
}

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !hasRole(user, ROLE_ADMIN)) {
    throw new Error('只有管理员可以执行该操作');
  }

  return user;
}

function createEmptyStats() {
  return {
    totalShifts: 0,
    completedShifts: 0,
    leaveShifts: 0,
    absentShifts: 0,
    lateShifts: 0,
    swapShifts: 0,
    validHours: 0,
    confirmPending: 0,
    paidHours: 0,
    unpaidHours: 0,
    paidAmount: 0,
    paidShiftCount: 0,
    unpaidShiftCount: 0,
  };
}

function roundHours(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getValidScheduleHours(schedule) {
  const isValid = schedule.checkOutTime
    && (schedule.attendanceStatus === ATTENDANCE_NORMAL || schedule.attendanceStatus === ATTENDANCE_LATE)
    && schedule.shiftType !== SHIFT_TYPE_LEAVE
    && schedule.attendanceStatus !== ATTENDANCE_ABSENT;

  if (!isValid) {
    return 0;
  }

  const hours = Number(schedule.fixedHours) || 0;
  const overtime = schedule.overtimeApproved ? (Number(schedule.overtimeHours) || 0) : 0;
  return roundHours(hours + overtime);
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const semesterId = String(event.semesterId || '').trim();

  if (!requesterId) {
    return { success: false, error: '请求用户不能为空' };
  }

  try {
    await ensureAdmin(requesterId);

    const [semester, users] = await Promise.all([
      findSemester(semesterId),
      loadAllDocuments(db.collection('users'), {}, { orderByField: 'studentId' }),
    ]);

    const schedules = semester
      ? await loadAllDocuments(db.collection('schedules'), { semesterId: semester._id })
      : [];

    const statsMap = {};
    users.forEach((user) => {
      statsMap[user._id] = createEmptyStats();
    });

    let totalValidHours = 0;
    let totalPaidHours = 0;
    let totalUnpaidHours = 0;
    let totalPaidAmount = 0;

    schedules.forEach((schedule) => {
      if (!schedule || !schedule.userId || !statsMap[schedule.userId]) {
        return;
      }

      const stats = statsMap[schedule.userId];
      stats.totalShifts += 1;

      if (schedule.shiftType === SHIFT_TYPE_LEAVE) {
        stats.leaveShifts += 1;
      }

      if (schedule.shiftType === SHIFT_TYPE_SWAP) {
        stats.swapShifts += 1;
      }

      if (schedule.attendanceStatus === ATTENDANCE_ABSENT) {
        stats.absentShifts += 1;
      }

      if (schedule.attendanceStatus === ATTENDANCE_LATE) {
        stats.lateShifts += 1;
      }

      if (schedule.checkOutTime) {
        stats.completedShifts += 1;
      }

      if (schedule.leaderConfirmStatus == null && schedule.shiftType !== SHIFT_TYPE_LEAVE && !schedule.checkOutTime) {
        stats.confirmPending += 1;
      }

      const actualHours = getValidScheduleHours(schedule);
      if (!actualHours) {
        return;
      }

      stats.validHours = roundHours(stats.validHours + actualHours);
      totalValidHours = roundHours(totalValidHours + actualHours);

      if (schedule.salaryPaid) {
        const salaryAmount = roundHours(schedule.salaryAmount || 0);
        stats.paidHours = roundHours(stats.paidHours + actualHours);
        stats.paidAmount = roundHours(stats.paidAmount + salaryAmount);
        stats.paidShiftCount += 1;

        totalPaidHours = roundHours(totalPaidHours + actualHours);
        totalPaidAmount = roundHours(totalPaidAmount + salaryAmount);
      } else {
        stats.unpaidHours = roundHours(stats.unpaidHours + actualHours);
        stats.unpaidShiftCount += 1;
        totalUnpaidHours = roundHours(totalUnpaidHours + actualHours);
      }
    });

    const summary = {
      totalUserCount: users.length,
      memberCount: users.filter((user) => !hasRole(user, ROLE_LEADER) && !hasRole(user, ROLE_ADMIN)).length,
      leaderCount: users.filter((user) => hasRole(user, ROLE_LEADER)).length,
      adminCount: users.filter((user) => hasRole(user, ROLE_ADMIN)).length,
      totalSchedules: schedules.length,
      totalValidHours,
      totalPaidHours,
      totalUnpaidHours,
      totalPaidAmount,
    };

    return {
      success: true,
      semester,
      summary,
      users: users.map((user) => ({
        ...omitPassword(user),
        stats: statsMap[user._id] || createEmptyStats(),
      })),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
