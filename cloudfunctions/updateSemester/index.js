const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];

function normalizeString(value) {
  return String(value || '').trim();
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidDateTimeString(value) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value);
}

function toBoolean(value, fallbackValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value == null) {
    return fallbackValue;
  }

  if (value === 1 || value === '1' || value === 'true') {
    return true;
  }

  if (value === 0 || value === '0' || value === 'false') {
    return false;
  }

  return fallbackValue;
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
    throw new Error('只有管理员可以修改学期');
  }

  return user;
}

exports.main = async (event = {}) => {
  const requesterId = normalizeString(event.requesterId);
  const semesterId = normalizeString(event.semesterId);
  const name = normalizeString(event.name);
  const startDate = normalizeString(event.startDate);
  const endDate = normalizeString(event.endDate);
  const hasSelectionEditWindowEnabled = Object.prototype.hasOwnProperty.call(event, 'selectionEditWindowEnabled');
  const hasSelectionEditStartAt = Object.prototype.hasOwnProperty.call(event, 'selectionEditStartAt');
  const hasSelectionEditEndAt = Object.prototype.hasOwnProperty.call(event, 'selectionEditEndAt');
  const rawSelectionEditStartAt = normalizeString(event.selectionEditStartAt);
  const rawSelectionEditEndAt = normalizeString(event.selectionEditEndAt);

  if (!requesterId || !semesterId || !name || !startDate || !endDate) {
    return { success: false, error: '参数不完整' };
  }

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return { success: false, error: '日期格式应为 YYYY-MM-DD' };
  }

  if (startDate > endDate) {
    return { success: false, error: '学期开始时间不能晚于结束时间' };
  }

  try {
    await ensureAdmin(requesterId);

    const semesterResult = await db.collection('semesters').doc(semesterId).get();
    const semester = semesterResult.data || null;
    if (!semester || semester.status !== 'active') {
      return { success: false, error: '学期不存在或不可编辑' };
    }

    const selectionEditWindowEnabled = hasSelectionEditWindowEnabled
      ? toBoolean(event.selectionEditWindowEnabled, false)
      : Boolean(semester.selectionEditWindowEnabled);
    let selectionEditStartAt = hasSelectionEditStartAt
      ? rawSelectionEditStartAt
      : normalizeString(semester.selectionEditStartAt);
    let selectionEditEndAt = hasSelectionEditEndAt
      ? rawSelectionEditEndAt
      : normalizeString(semester.selectionEditEndAt);

    if (!selectionEditWindowEnabled) {
      selectionEditStartAt = '';
      selectionEditEndAt = '';
    } else {
      if (!selectionEditStartAt || !selectionEditEndAt) {
        return { success: false, error: '请完整设置调班开放时间段' };
      }

      if (!isValidDateTimeString(selectionEditStartAt) || !isValidDateTimeString(selectionEditEndAt)) {
        return { success: false, error: '调班时间格式应为 YYYY-MM-DD HH:mm' };
      }

      if (selectionEditStartAt > selectionEditEndAt) {
        return { success: false, error: '调班开放开始时间不能晚于结束时间' };
      }
    }

    const overlapResult = await db.collection('semesters')
      .where({
        status: 'active',
        startDate: db.command.lte(endDate),
        endDate: db.command.gte(startDate),
      })
      .limit(100)
      .get();
    const hasOverlap = (overlapResult.data || []).some((item) => {
      return String(item._id || '').trim() !== semesterId;
    });

    if (hasOverlap) {
      return { success: false, error: '该时间段与已有学期重叠' };
    }

    await db.collection('semesters').doc(semesterId).update({
      data: {
        name,
        startDate,
        endDate,
        selectionEditWindowEnabled,
        selectionEditStartAt,
        selectionEditEndAt,
        updatedAt: db.serverDate(),
      },
    });

    return {
      success: true,
      message: '学期已更新',
      semesterId,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
