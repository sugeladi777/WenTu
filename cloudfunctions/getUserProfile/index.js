const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const SHIFT_TYPE_LEAVE = 1;
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

async function syncUserRoleFields(user) {
  if (!user || !user._id) {
    return user;
  }

  const normalizedRoles = normalizeRoles(user);
  const leaderScheduleResult = await db.collection('schedules')
    .where({
      userId: user._id,
      leaderUserId: user._id,
      shiftType: db.command.neq(SHIFT_TYPE_LEAVE),
    })
    .limit(1)
    .get();

  const hasLeaderAssignment = Boolean(leaderScheduleResult.data && leaderScheduleResult.data.length > 0);
  const roles = hasLeaderAssignment
    ? [...new Set([...normalizedRoles, ROLE_LEADER])].sort((left, right) => left - right)
    : normalizedRoles.filter((item) => item !== ROLE_LEADER);
  const currentRoles = Array.isArray(user.roles) ? user.roles : [];
  const primaryRole = getPrimaryRole(roles);
  const shouldUpdate = currentRoles.length !== roles.length
    || currentRoles.some((item, index) => Number(item) !== roles[index])
    || Number(user.role) !== primaryRole;

  if (!shouldUpdate) {
    return {
      ...user,
      roles,
      role: primaryRole,
    };
  }

  await db.collection('users').doc(user._id).update({
    data: {
      roles,
      role: primaryRole,
      updatedAt: db.serverDate(),
    },
  });

  return {
    ...user,
    roles,
    role: primaryRole,
  };
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();

  if (!userId) {
    return { success: false, error: '用户 ID 不能为空' };
  }

  try {
    const result = await db.collection('users').doc(userId).get();
    if (!result.data) {
      return { success: false, error: '用户不存在' };
    }

    const normalizedUser = await syncUserRoleFields(result.data);

    return {
      success: true,
      userInfo: omitPassword(normalizedUser),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
