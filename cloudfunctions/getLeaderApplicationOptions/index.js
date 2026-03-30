const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_NORMAL = 0;
const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];
const WEEKDAY_TEXTS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

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

async function loadAllDocuments(collection, filter = {}) {
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

async function loadOptionalDocuments(collectionName, filter = {}) {
  try {
    return await loadAllDocuments(db.collection(collectionName), filter);
  } catch (error) {
    const message = String(error && error.message ? error.message : '');
    if (/collection/i.test(message) && /not\s*exist/i.test(message)) {
      return [];
    }
    throw error;
  }
}

async function ensureUser(userId) {
  const result = await db.collection('users').doc(userId).get();
  const user = result.data || null;

  if (!user) {
    throw new Error('用户不存在');
  }

  return user;
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

function getRecurringKey(schedule = {}) {
  const dayOfWeek = Number(schedule.dayOfWeek);
  if (schedule.shiftId) {
    return `${schedule.semesterId || ''}::${dayOfWeek}::${schedule.shiftId}`;
  }

  return `${schedule.semesterId || ''}::${dayOfWeek}::${schedule.startTime || ''}::${schedule.endTime || ''}`;
}

function buildRecurringMatcher(schedule = {}) {
  const matcher = {
    semesterId: schedule.semesterId,
    dayOfWeek: Number(schedule.dayOfWeek),
  };

  if (schedule.shiftId) {
    matcher.shiftId = schedule.shiftId;
    return matcher;
  }

  matcher.startTime = schedule.startTime;
  matcher.endTime = schedule.endTime;
  return matcher;
}

function getTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function sortSchedules(list = []) {
  return list.slice().sort((left, right) => {
    const leftDay = Number(left.dayOfWeek);
    const rightDay = Number(right.dayOfWeek);
    if (leftDay !== rightDay) {
      return leftDay - rightDay;
    }

    const startCompare = String(left.startTime || '').localeCompare(String(right.startTime || ''));
    if (startCompare !== 0) {
      return startCompare;
    }

    return String(left.shiftName || '').localeCompare(String(right.shiftName || ''));
  });
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const semesterId = String(event.semesterId || '').trim();

  if (!userId) {
    return { success: false, error: '用户不能为空' };
  }

  try {
    const user = await ensureUser(userId);
    const semester = await findSemester(semesterId);

    if (!semester || !semester._id) {
      return {
        success: true,
        semester: null,
        slots: [],
      };
    }

    const schedules = await loadAllDocuments(db.collection('schedules'), {
      userId,
      semesterId: semester._id,
    });

    const ownFixedSchedules = sortSchedules(schedules.filter((item) => {
      return item
        && item.shiftType === SHIFT_TYPE_NORMAL
        && !Number.isNaN(Number(item.dayOfWeek))
        && Number(item.dayOfWeek) >= 0
        && Number(item.dayOfWeek) <= 6;
    }));

    if (!ownFixedSchedules.length) {
      return {
        success: true,
        semester,
        slots: [],
      };
    }

    const applicationList = await loadOptionalDocuments('leaderApplications', {
      semesterId: semester._id,
      userId,
    });

    const latestApplicationMap = {};
    applicationList.forEach((item) => {
      const key = getRecurringKey(item);
      const current = latestApplicationMap[key];
      if (!current || getTimestamp(item.createdAt || item.updatedAt) >= getTimestamp(current.createdAt || current.updatedAt)) {
        latestApplicationMap[key] = item;
      }
    });

    const slotMap = {};
    ownFixedSchedules.forEach((schedule) => {
      const key = getRecurringKey(schedule);
      if (!slotMap[key]) {
        slotMap[key] = schedule;
      }
    });

    const slots = await Promise.all(Object.values(slotMap).map(async (schedule) => {
      const recurringSchedules = await loadAllDocuments(
        db.collection('schedules'),
        buildRecurringMatcher(schedule),
      );
      const leaderSchedule = recurringSchedules.find((item) => String(item.leaderUserId || '').trim()) || null;
      const latestApplication = latestApplicationMap[getRecurringKey(schedule)] || null;
      const currentLeaderUserId = leaderSchedule ? String(leaderSchedule.leaderUserId || '').trim() : '';
      const currentLeaderUserName = leaderSchedule ? String(leaderSchedule.leaderUserName || '').trim() : '';
      const isCurrentLeader = currentLeaderUserId === userId;
      const applicationStatus = latestApplication ? String(latestApplication.status || '') : '';
      const hasPendingApplication = applicationStatus === 'pending';
      let statusText = '当前未任命班负';
      let statusTone = 'muted';
      let buttonText = '申请成为班负';
      let canApply = true;

      if (isCurrentLeader) {
        statusText = '你已负责这个固定班次';
        statusTone = 'success';
        buttonText = '已负责';
        canApply = false;
      } else if (hasPendingApplication) {
        statusText = '申请已提交，等待管理员审批';
        statusTone = 'warning';
        buttonText = '待审批';
        canApply = false;
      } else if (applicationStatus === 'rejected') {
        statusText = '上次申请未通过，可重新提交';
        statusTone = 'warning';
        buttonText = currentLeaderUserId ? '申请改派' : '重新申请';
      } else if (currentLeaderUserId) {
        statusText = `当前由 ${currentLeaderUserName || '其他同学'} 负责`;
        statusTone = 'primary';
        buttonText = '申请改派';
      }

      return {
        slotKey: getRecurringKey(schedule),
        scheduleId: schedule._id,
        semesterId: semester._id,
        shiftId: schedule.shiftId || '',
        shiftName: schedule.shiftName || '未命名班次',
        startTime: schedule.startTime || '',
        endTime: schedule.endTime || '',
        fixedHours: Number(schedule.fixedHours || 0),
        dayOfWeek: Number(schedule.dayOfWeek),
        weekdayText: WEEKDAY_TEXTS[Number(schedule.dayOfWeek)] || '',
        currentLeaderUserId,
        currentLeaderUserName,
        applicationStatus,
        statusText,
        statusTone,
        buttonText,
        canApply,
      };
    }));

    return {
      success: true,
      semester,
      userHasLeaderRole: hasRole(user, ROLE_LEADER),
      slots: sortSchedules(slots),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
