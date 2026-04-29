const cloud = require('wx-server-sdk');
const bcrypt = require('bcryptjs');

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

function normalizePassword(value) {
  return String(value || '');
}

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !hasRole(user, ROLE_ADMIN)) {
    throw new Error('只有管理员可以重置密码');
  }

  return user;
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const targetUserId = String(event.targetUserId || '').trim();
  const newPassword = normalizePassword(event.newPassword);

  if (!requesterId || !targetUserId) {
    return { success: false, error: '参数错误' };
  }

  if (!newPassword) {
    return { success: false, error: '请填写新密码' };
  }

  if (newPassword.length < 6) {
    return { success: false, error: '新密码至少 6 位' };
  }

  try {
    const requester = await ensureAdmin(requesterId);
    const targetResult = await db.collection('users').doc(targetUserId).get();
    const targetUser = targetResult.data || null;

    if (!targetUser) {
      return { success: false, error: '目标用户不存在' };
    }

    const password = await hashPassword(newPassword);

    await db.collection('users').doc(targetUserId).update({
      data: {
        password,
        passwordResetAt: db.serverDate(),
        passwordResetBy: requesterId,
        passwordResetByName: requester.name || '',
        updatedAt: db.serverDate(),
      },
    });

    return {
      success: true,
      message: '密码已重置',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
