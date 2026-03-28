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

function buildSlotMatcher(schedule) {
  if (schedule.shiftId) {
    return {
      date: schedule.date,
      shiftId: schedule.shiftId,
    };
  }

  return {
    date: schedule.date,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
  };
}

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !hasRole(user, ROLE_ADMIN)) {
    throw new Error('只有管理员可以任命班负');
  }

  return user;
}

async function syncLeaderRole(userId) {
  const normalizedUserId = String(userId || '').trim();
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
      shiftType: db.command.neq(SHIFT_TYPE_LEAVE),
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

async function updateSlotLeader(schedule, leaderUserId, leaderUserName) {
  const slotResult = await db.collection('schedules')
    .where(buildSlotMatcher(schedule))
    .limit(100)
    .get();

  const slotSchedules = slotResult.data || [];
  if (!slotSchedules.length) {
    throw new Error('班次数据不存在');
  }

  await Promise.all(slotSchedules.map((item) => {
    return db.collection('schedules').doc(item._id).update({
      data: {
        leaderUserId,
        leaderUserName,
        updatedAt: db.serverDate(),
      },
    });
  }));

  return slotSchedules;
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const scheduleId = String(event.scheduleId || '').trim();
  const action = String(event.action || '').trim();

  if (!requesterId || !scheduleId || !action) {
    return { success: false, error: '参数错误' };
  }

  if (!['assign', 'clear'].includes(action)) {
    return { success: false, error: '不支持的操作' };
  }

  try {
    await ensureAdmin(requesterId);

    const scheduleResult = await db.collection('schedules').doc(scheduleId).get();
    const schedule = scheduleResult.data || null;
    if (!schedule) {
      return { success: false, error: '班次不存在' };
    }

    if (schedule.shiftType === SHIFT_TYPE_LEAVE) {
      return { success: false, error: '请假班次不能任命班负' };
    }

    const slotSchedules = await db.collection('schedules')
      .where(buildSlotMatcher(schedule))
      .limit(100)
      .get();
    const slotList = slotSchedules.data || [];
    const currentLeaderIds = [...new Set(slotList.map((item) => String(item.leaderUserId || '').trim()).filter(Boolean))];

    if (action === 'clear' && currentLeaderIds.length > 0 && !currentLeaderIds.includes(String(schedule.userId || '').trim())) {
      return { success: false, error: '当前志愿者不是该班次班负' };
    }

    const nextLeaderUserId = action === 'assign' ? String(schedule.userId || '').trim() : null;
    const nextLeaderUserName = action === 'assign' ? String(schedule.userName || '').trim() : '';

    const updatedSlotSchedules = await updateSlotLeader(schedule, nextLeaderUserId, nextLeaderUserName);
    const affectedUserIds = new Set(currentLeaderIds);

    if (nextLeaderUserId) {
      affectedUserIds.add(nextLeaderUserId);
    }

    await Promise.all([...affectedUserIds].map((userId) => syncLeaderRole(userId)));

    return {
      success: true,
      message: action === 'assign' ? '班次班负已更新' : '已撤销该班次班负',
      slotScheduleCount: updatedSlotSchedules.length,
      leaderUserId: nextLeaderUserId,
      leaderUserName: nextLeaderUserName,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
