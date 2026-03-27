const { USER_ROLE } = require('./constants');

const ROLE_DISPLAY_ORDER = [USER_ROLE.MEMBER, USER_ROLE.LEADER, USER_ROLE.ADMIN];
const VALID_ROLES = new Set(ROLE_DISPLAY_ORDER);

function sortRoles(roles) {
  return roles.slice().sort((left, right) => {
    return ROLE_DISPLAY_ORDER.indexOf(left) - ROLE_DISPLAY_ORDER.indexOf(right);
  });
}

function normalizeRoles(rawRoles, legacyRole = USER_ROLE.MEMBER) {
  const roles = [];
  const sourceRoles = Array.isArray(rawRoles) ? rawRoles : [];

  sourceRoles.forEach((item) => {
    const role = Number(item);
    if (VALID_ROLES.has(role) && !roles.includes(role)) {
      roles.push(role);
    }
  });

  const fallbackRole = Number(legacyRole);
  if (!roles.length && VALID_ROLES.has(fallbackRole)) {
    roles.push(fallbackRole);
  }

  if (!roles.includes(USER_ROLE.MEMBER)) {
    roles.push(USER_ROLE.MEMBER);
  }

  return sortRoles(roles);
}

function getPrimaryRole(roles) {
  if (roles.includes(USER_ROLE.ADMIN)) {
    return USER_ROLE.ADMIN;
  }

  if (roles.includes(USER_ROLE.LEADER)) {
    return USER_ROLE.LEADER;
  }

  return USER_ROLE.MEMBER;
}

function normalizeUserRoles(userInfo, preferredActiveRole) {
  if (!userInfo || typeof userInfo !== 'object' || !userInfo._id) {
    return null;
  }

  const roles = normalizeRoles(
    userInfo.roles,
    userInfo.primaryRole != null ? userInfo.primaryRole : userInfo.role,
  );
  const requestedActiveRole = preferredActiveRole != null
    ? Number(preferredActiveRole)
    : Number(userInfo.activeRole);
  const activeRole = roles.includes(requestedActiveRole)
    ? requestedActiveRole
    : getPrimaryRole(roles);

  return {
    ...userInfo,
    roles,
    activeRole,
    role: activeRole,
    primaryRole: getPrimaryRole(roles),
  };
}

function getRoleText(role) {
  switch (Number(role)) {
    case USER_ROLE.LEADER:
      return '班负';
    case USER_ROLE.ADMIN:
      return '管理员';
    default:
      return '志愿者';
  }
}

function getRoleDescription(role) {
  switch (Number(role)) {
    case USER_ROLE.LEADER:
      return '处理本人班次，并确认当前班次成员的签到情况。';
    case USER_ROLE.ADMIN:
      return '查看全员工作概况、任命班负并管理整体运行。';
    default:
      return '查看个人排班、完成签到签退以及请假替班。';
  }
}

function getRoleTheme(role) {
  switch (Number(role)) {
    case USER_ROLE.LEADER:
      return 'leader';
    case USER_ROLE.ADMIN:
      return 'admin';
    default:
      return 'member';
  }
}

function getActiveRole(userInfo) {
  const normalized = normalizeUserRoles(userInfo);
  return normalized ? normalized.activeRole : USER_ROLE.MEMBER;
}

function hasRole(userInfo, role) {
  if (!userInfo) {
    return false;
  }

  return normalizeRoles(
    userInfo.roles,
    userInfo.primaryRole != null ? userInfo.primaryRole : userInfo.role,
  ).includes(Number(role));
}

function getRoleOptions(userInfo) {
  const normalized = normalizeUserRoles(userInfo);
  if (!normalized) {
    return [];
  }

  return normalized.roles.map((role) => ({
    role,
    text: getRoleText(role),
    description: getRoleDescription(role),
    theme: getRoleTheme(role),
  }));
}

function formatGrantedRoles(userInfo) {
  const normalized = normalizeUserRoles(userInfo);
  if (!normalized) {
    return '';
  }

  return normalized.roles.map((role) => getRoleText(role)).join(' / ');
}

module.exports = {
  formatGrantedRoles,
  getActiveRole,
  getPrimaryRole,
  getRoleDescription,
  getRoleOptions,
  getRoleText,
  getRoleTheme,
  hasRole,
  normalizeRoles,
  normalizeUserRoles,
};
