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

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !hasRole(user, ROLE_ADMIN)) {
    throw new Error('只有管理员可以执行该操作');
  }

  return user;
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const targetUserId = String(event.targetUserId || '').trim();
  const role = Number(event.role);

  if (!requesterId || !targetUserId || Number.isNaN(role)) {
    return { success: false, error: '参数错误' };
  }

  if (![ROLE_MEMBER, ROLE_LEADER].includes(role)) {
    return { success: false, error: '当前只支持调整班负身份' };
  }

  try {
    await ensureAdmin(requesterId);

    const targetResult = await db.collection('users').doc(targetUserId).get();
    const targetUser = targetResult.data || null;

    if (!targetUser) {
      return { success: false, error: '目标用户不存在' };
    }

    const currentRoles = normalizeRoles(targetUser);
    const nextRoles = role === ROLE_LEADER
      ? [...new Set([...currentRoles, ROLE_LEADER])].sort((left, right) => left - right)
      : currentRoles.filter((item) => item !== ROLE_LEADER);

    if (!nextRoles.includes(ROLE_MEMBER)) {
      nextRoles.push(ROLE_MEMBER);
      nextRoles.sort((left, right) => left - right);
    }

    const primaryRole = getPrimaryRole(nextRoles);

    await db.collection('users').doc(targetUserId).update({
      data: {
        roles: nextRoles,
        role: primaryRole,
        updatedAt: db.serverDate(),
      },
    });

    const updatedResult = await db.collection('users').doc(targetUserId).get();

    return {
      success: true,
      userInfo: omitPassword(updatedResult.data),
      message: role === ROLE_LEADER ? '已授予班负身份' : '已撤销班负身份',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
