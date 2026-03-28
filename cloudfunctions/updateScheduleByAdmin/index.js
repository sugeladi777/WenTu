const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const SHIFT_TYPE_LEAVE = 1;
const SHIFT_TYPE_SWAP = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];
const IMMUTABLE_FIELDS = new Set(['_id', '_openid']);
const DATE_FIELDS = new Set([
  'checkInTime',
  'checkOutTime',
  'leaveApprovedAt',
  'leaderConfirmedAt',
  'salaryPaidAt',
  'leaveRequestedAt',
  'overtimeRequestedAt',
  'overtimeReviewedAt',
  'createdAt',
  'updatedAt',
]);
const DECIMAL_FIELDS = new Set([
  'fixedHours',
  'overtimeHours',
  'salaryAmount',
  'salaryRate',
]);
const INTEGER_FIELDS = new Set([
  'dayOfWeek',
  'shiftType',
  'attendanceStatus',
  'leaveStatus',
]);
const BOOLEAN_FIELDS = new Set([
  'overtimeApproved',
  'salaryPaid',
]);
const SHARED_LINK_FIELDS = [
  'semesterId',
  'date',
  'dayOfWeek',
  'shiftId',
  'shiftName',
  'startTime',
  'endTime',
  'fixedHours',
  'leaderUserId',
  'leaderUserName',
];

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

function normalizeId(value, maxLength = 64) {
  return String(value || '').trim().slice(0, maxLength);
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isValidTimeString(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ''));
}

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function getDayOfWeek(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const weekday = date.getDay();
  return weekday === 0 ? 6 : weekday - 1;
}

function normalizeDateValue(value, fieldName) {
  if (value == null || value === '') {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${fieldName} 时间格式不正确`);
    }
    return value;
  }

  if (typeof value === 'object' && typeof value.seconds === 'number') {
    const date = new Date(value.seconds * 1000);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`${fieldName} 时间格式不正确`);
    }
    return date;
  }

  if (typeof value === 'object' && value.$date) {
    const date = new Date(value.$date);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`${fieldName} 时间格式不正确`);
    }
    return date;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} 时间格式不正确`);
  }

  return date;
}

function normalizeDecimalValue(value, fieldName) {
  if (value == null || value === '') {
    return null;
  }

  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) {
    throw new Error(`${fieldName} 数值格式不正确`);
  }

  return Math.round(numberValue * 100) / 100;
}

function normalizeIntegerValue(value, fieldName) {
  if (value == null || value === '') {
    return null;
  }

  const numberValue = Number(value);
  if (!Number.isInteger(numberValue)) {
    throw new Error(`${fieldName} 必须是整数`);
  }

  return numberValue;
}

function normalizeBooleanValue(value) {
  if (value === true || value === false) {
    return value;
  }

  if (value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === 'false' || value === '0' || value === 0 || value == null || value === '') {
    return false;
  }

  return Boolean(value);
}

function normalizeScheduleRecord(scheduleData = {}) {
  const normalized = {};

  Object.keys(scheduleData).forEach((key) => {
    if (IMMUTABLE_FIELDS.has(key)) {
      return;
    }

    const value = scheduleData[key];

    if (DATE_FIELDS.has(key)) {
      normalized[key] = normalizeDateValue(value, key);
      return;
    }

    if (DECIMAL_FIELDS.has(key)) {
      normalized[key] = normalizeDecimalValue(value, key);
      return;
    }

    if (INTEGER_FIELDS.has(key)) {
      normalized[key] = normalizeIntegerValue(value, key);
      return;
    }

    if (BOOLEAN_FIELDS.has(key)) {
      normalized[key] = normalizeBooleanValue(value);
      return;
    }

    normalized[key] = value;
  });

  return normalized;
}

function validateScheduleRecord(schedule = {}) {
  if (!schedule.date || !isValidDateString(schedule.date)) {
    throw new Error('date 必须是 YYYY-MM-DD 格式');
  }

  if (!schedule.startTime || !isValidTimeString(schedule.startTime)) {
    throw new Error('startTime 必须是 HH:mm 格式');
  }

  if (!schedule.endTime || !isValidTimeString(schedule.endTime)) {
    throw new Error('endTime 必须是 HH:mm 格式');
  }

  const startMinutes = timeToMinutes(schedule.startTime);
  const endMinutes = timeToMinutes(schedule.endTime);
  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    throw new Error('开始时间必须早于结束时间');
  }

  const computedDayOfWeek = getDayOfWeek(schedule.date);
  if (computedDayOfWeek == null) {
    throw new Error('date 对应的星期信息无效');
  }
  schedule.dayOfWeek = computedDayOfWeek;

  if (schedule.fixedHours != null && schedule.fixedHours < 0) {
    throw new Error('fixedHours 不能小于 0');
  }

  if (schedule.overtimeHours != null && schedule.overtimeHours < 0) {
    throw new Error('overtimeHours 不能小于 0');
  }

  if (schedule.shiftType != null && ![0, 1, 2, 3].includes(schedule.shiftType)) {
    throw new Error('shiftType 取值无效');
  }

  if (schedule.attendanceStatus != null && ![0, 1, 2, 3].includes(schedule.attendanceStatus)) {
    throw new Error('attendanceStatus 取值无效');
  }

  if (schedule.leaveStatus != null && ![0, 1, 2].includes(schedule.leaveStatus)) {
    throw new Error('leaveStatus 取值无效');
  }
}

function buildUpdatePayload(currentSchedule = {}, nextSchedule = {}) {
  const payload = {};

  Object.keys(currentSchedule).forEach((key) => {
    if (IMMUTABLE_FIELDS.has(key)) {
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(nextSchedule, key)) {
      payload[key] = _.remove();
    }
  });

  Object.keys(nextSchedule).forEach((key) => {
    if (IMMUTABLE_FIELDS.has(key)) {
      return;
    }

    payload[key] = nextSchedule[key];
  });

  payload.updatedAt = db.serverDate();
  return payload;
}

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !hasRole(user, ROLE_ADMIN)) {
    throw new Error('只有管理员可以编辑班次');
  }

  return user;
}

async function loadSchedule(scheduleId) {
  if (!scheduleId) {
    return null;
  }

  const result = await db.collection('schedules').doc(scheduleId).get();
  return result.data || null;
}

function getLinkedScheduleId(schedule = {}) {
  if (schedule.shiftType === SHIFT_TYPE_LEAVE) {
    return normalizeId(schedule.replacementScheduleId);
  }

  if (schedule.shiftType === SHIFT_TYPE_SWAP) {
    return normalizeId(schedule.relatedLeaveScheduleId);
  }

  return '';
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

async function syncLeaderRole(userId) {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) {
    return;
  }

  const userResult = await db.collection('users').doc(normalizedUserId).get();
  const user = userResult.data || null;
  if (!user) {
    return;
  }

  const currentRoles = normalizeRoles(user);
  const leaderScheduleResult = await db.collection('schedules')
    .where({
      userId: normalizedUserId,
      leaderUserId: normalizedUserId,
      shiftType: _.neq(SHIFT_TYPE_LEAVE),
    })
    .limit(1)
    .get();

  const hasLeaderAssignment = Boolean(leaderScheduleResult.data && leaderScheduleResult.data.length > 0);
  const nextRoles = hasLeaderAssignment
    ? [...new Set([...currentRoles, ROLE_LEADER])].sort((left, right) => left - right)
    : currentRoles.filter((item) => item !== ROLE_LEADER);
  const primaryRole = getPrimaryRole(nextRoles);
  const rawRoles = Array.isArray(user.roles) ? user.roles : [];
  const shouldUpdate = rawRoles.length !== nextRoles.length
    || rawRoles.some((item, index) => Number(item) !== nextRoles[index])
    || Number(user.role) !== primaryRole;

  if (!shouldUpdate) {
    return;
  }

  await db.collection('users').doc(normalizedUserId).update({
    data: {
      roles: nextRoles,
      role: primaryRole,
      updatedAt: db.serverDate(),
    },
  });
}

async function syncAffectedUserRoles(beforeSchedule = {}, afterSchedule = {}) {
  const userIds = new Set([
    normalizeId(beforeSchedule.userId),
    normalizeId(afterSchedule.userId),
    normalizeId(beforeSchedule.leaderUserId),
    normalizeId(afterSchedule.leaderUserId),
  ]);

  const tasks = [...userIds]
    .filter(Boolean)
    .map((userId) => syncLeaderRole(userId));

  await Promise.all(tasks);
}

async function syncLinkedSchedule(updatedSchedule = {}) {
  const linkedScheduleId = getLinkedScheduleId(updatedSchedule);
  if (!linkedScheduleId || linkedScheduleId === updatedSchedule._id) {
    return;
  }

  const linkedSchedule = await loadSchedule(linkedScheduleId);
  if (!linkedSchedule) {
    return;
  }

  const linkedPayload = {};
  SHARED_LINK_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(updatedSchedule, field)) {
      linkedPayload[field] = updatedSchedule[field];
    } else {
      linkedPayload[field] = _.remove();
    }
  });
  linkedPayload.updatedAt = db.serverDate();

  await db.collection('schedules').doc(linkedScheduleId).update({
    data: linkedPayload,
  });
}

exports.main = async (event = {}) => {
  const requesterId = normalizeId(event.requesterId);
  const scheduleId = normalizeId(event.scheduleId);
  const rawScheduleData = event.scheduleData;

  if (!requesterId || !scheduleId || !isPlainObject(rawScheduleData)) {
    return { success: false, error: '参数不完整' };
  }

  try {
    await ensureAdmin(requesterId);

    const currentSchedule = await loadSchedule(scheduleId);
    if (!currentSchedule) {
      return { success: false, error: '班次不存在' };
    }

    if (rawScheduleData._id && normalizeId(rawScheduleData._id) !== scheduleId) {
      return { success: false, error: '不能修改班次 _id' };
    }

    const nextSchedule = normalizeScheduleRecord(rawScheduleData);
    validateScheduleRecord(nextSchedule);

    const payload = buildUpdatePayload(currentSchedule, nextSchedule);
    await db.collection('schedules').doc(scheduleId).update({
      data: payload,
    });

    const updatedSchedule = await loadSchedule(scheduleId);
    if (!updatedSchedule) {
      throw new Error('班次更新后读取失败');
    }

    await syncLinkedSchedule(updatedSchedule);
    await syncAffectedUserRoles(currentSchedule, updatedSchedule);

    return {
      success: true,
      message: '班次信息已更新',
      schedule: updatedSchedule,
    };
  } catch (error) {
    return { success: false, error: error.message || '班次更新失败' };
  }
};
