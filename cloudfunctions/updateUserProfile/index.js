const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];

function normalizeName(value) {
  return String(value || '').trim().slice(0, 30);
}

function normalizeNickname(value) {
  return String(value || '').trim().slice(0, 30);
}

function normalizeAvatar(value) {
  return String(value || '').trim();
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
    nickname: userInfo.nickname || userInfo.name || '',
    roles,
    role: primaryRole,
    primaryRole,
  };
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const name = normalizeName(event.name);
  const nickname = normalizeNickname(event.nickname);
  const avatar = normalizeAvatar(event.avatar);

  if (!userId) {
    return { success: false, error: '用户 ID 不能为空' };
  }

  if (!name) {
    return { success: false, error: '姓名不能为空' };
  }

  try {
    const currentResult = await db.collection('users').doc(userId).get();
    if (!currentResult.data) {
      return { success: false, error: '用户不存在' };
    }

    await db.collection('users').doc(userId).update({
      data: {
        name,
        nickname: nickname || name,
        avatar: avatar || currentResult.data.avatar || '',
        updatedAt: db.serverDate(),
      },
    });

    const userResult = await db.collection('users').doc(userId).get();

    return {
      success: true,
      userInfo: omitPassword(userResult.data),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
