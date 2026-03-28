const cloud = require('wx-server-sdk');
const bcrypt = require('bcryptjs');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const SHIFT_TYPE_LEAVE = 1;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];

function normalizeStudentId(value) {
  return String(value || '').trim();
}

function normalizePassword(value) {
  return String(value || '');
}

function normalizeName(value) {
  return String(value || '').trim().slice(0, 30);
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
    nickname: '',
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

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function findUserByStudentId(studentId) {
  const result = await db.collection('users')
    .where({ studentId })
    .limit(1)
    .get();

  return result.data && result.data[0] ? result.data[0] : null;
}

async function registerUser(studentId, password, name) {
  const hashedPassword = await hashPassword(password);

  const result = await db.collection('users').add({
    data: {
      studentId,
      password: hashedPassword,
      name,
      nickname: '',
      role: ROLE_MEMBER,
      roles: [ROLE_MEMBER],
      avatar: '',
      rewardScore: 0,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });

  return result._id;
}

exports.main = async (event) => {
  const action = String(event.action || 'login').trim();
  const studentId = normalizeStudentId(event.studentId);
  const password = normalizePassword(event.password);
  const name = normalizeName(event.name);

  if (!studentId || !password) {
    return { success: false, error: '请输入学号和密码' };
  }

  try {
    if (action === 'register') {
      if (!name) {
        return { success: false, error: '请输入姓名' };
      }

      const existingUser = await findUserByStudentId(studentId);
      if (existingUser) {
        return { success: false, error: '该账号已存在' };
      }

      const userId = await registerUser(studentId, password, name);
      const newUser = await db.collection('users').doc(userId).get();

      return {
        success: true,
        message: '注册成功',
        userInfo: omitPassword(newUser.data),
      };
    }

    const user = await findUserByStudentId(studentId);
    if (!user) {
      return { success: false, error: '用户不存在' };
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return { success: false, error: '密码错误' };
    }

    const normalizedUser = await syncUserRoleFields(user);

    return {
      success: true,
      userInfo: omitPassword(normalizedUser),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
