const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];

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

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !hasRole(user, ROLE_ADMIN)) {
    throw new Error('只有管理员可以查看班次原始记录');
  }

  return user;
}

exports.main = async (event = {}) => {
  const requesterId = normalizeId(event.requesterId);
  const scheduleId = normalizeId(event.scheduleId);

  if (!requesterId || !scheduleId) {
    return { success: false, error: '参数错误' };
  }

  try {
    await ensureAdmin(requesterId);

    const scheduleResult = await db.collection('schedules').doc(scheduleId).get();
    const schedule = scheduleResult.data || null;

    if (!schedule) {
      return { success: false, error: '班次不存在' };
    }

    return {
      success: true,
      schedule,
    };
  } catch (error) {
    return { success: false, error: error.message || '获取班次失败' };
  }
};
