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

function buildRecurringMatcher(schedule) {
  const matcher = {
    semesterId: schedule.semesterId,
    dayOfWeek: schedule.dayOfWeek,
  };

  if (schedule.shiftId) {
    matcher.shiftId = schedule.shiftId;
    return matcher;
  }

  matcher.startTime = schedule.startTime;
  matcher.endTime = schedule.endTime;
  return matcher;
}

function buildDateSlotKey(schedule) {
  if (schedule.shiftId) {
    return `${schedule.date}::${schedule.shiftId}`;
  }

  return `${schedule.date}::${schedule.startTime}::${schedule.endTime}`;
}

async function loadAllDocuments(collection, filter = {}) {
  const pageSize = 100;
  const documents = [];
  let offset = 0;

  while (true) {
    const result = await collection
      .where(filter)
      .skip(offset)
      .limit(pageSize)
      .get();
    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
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

async function updateRecurringLeader(schedule, targetUserId, targetUserName, action) {
  const recurringSchedules = await loadAllDocuments(
    db.collection('schedules'),
    buildRecurringMatcher(schedule),
  );

  if (!recurringSchedules.length) {
    throw new Error('固定班次数据不存在');
  }

  const groupedByDateSlot = {};
  const currentLeaderIds = new Set();

  recurringSchedules.forEach((item) => {
    const groupKey = buildDateSlotKey(item);
    if (!groupedByDateSlot[groupKey]) {
      groupedByDateSlot[groupKey] = [];
    }

    groupedByDateSlot[groupKey].push(item);

    const currentLeaderId = String(item.leaderUserId || '').trim();
    if (currentLeaderId) {
      currentLeaderIds.add(currentLeaderId);
    }
  });

  if (
    action === 'clear'
    && !recurringSchedules.some((item) => String(item.leaderUserId || '').trim() === targetUserId)
  ) {
    throw new Error('当前志愿者不是该固定班次班负');
  }

  let affectedScheduleCount = 0;
  let affectedDateSlotCount = 0;

  for (const slotSchedules of Object.values(groupedByDateSlot)) {
    let nextLeaderUserId = null;
    let nextLeaderUserName = '';

    if (action === 'assign') {
      const targetOwnSchedule = slotSchedules.find((item) => {
        return String(item.userId || '').trim() === targetUserId
          && item.shiftType !== SHIFT_TYPE_LEAVE;
      });

      if (targetOwnSchedule) {
        nextLeaderUserId = targetUserId;
        nextLeaderUserName = targetUserName || String(targetOwnSchedule.userName || '').trim();
      }
    } else {
      const targetWasLeader = slotSchedules.some((item) => {
        return String(item.leaderUserId || '').trim() === targetUserId;
      });

      if (!targetWasLeader) {
        continue;
      }
    }

    const shouldUpdate = slotSchedules.some((item) => {
      const currentLeaderUserId = String(item.leaderUserId || '').trim();
      const currentLeaderUserName = String(item.leaderUserName || '').trim();
      return currentLeaderUserId !== String(nextLeaderUserId || '')
        || currentLeaderUserName !== String(nextLeaderUserName || '');
    });

    if (!shouldUpdate) {
      continue;
    }

    affectedDateSlotCount += 1;
    affectedScheduleCount += slotSchedules.length;

    await Promise.all(slotSchedules.map((item) => {
      return db.collection('schedules').doc(item._id).update({
        data: {
          leaderUserId: nextLeaderUserId || null,
          leaderUserName: nextLeaderUserName || '',
          updatedAt: db.serverDate(),
        },
      });
    }));
  }

  return {
    currentLeaderIds: [...currentLeaderIds],
    affectedScheduleCount,
    affectedDateSlotCount,
    leaderUserId: action === 'assign' ? targetUserId : null,
    leaderUserName: action === 'assign' ? (targetUserName || '') : '',
  };
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

    if (!schedule.semesterId || Number.isNaN(Number(schedule.dayOfWeek))) {
      return { success: false, error: '当前班次缺少固定班次信息，暂时不能按学期任命班负' };
    }

    if (schedule.shiftType === SHIFT_TYPE_LEAVE) {
      return { success: false, error: '请假班次不能任命班负' };
    }

    const targetUserId = String(schedule.userId || '').trim();
    const targetUserName = String(schedule.userName || '').trim();
    const recurringResult = await updateRecurringLeader(
      schedule,
      targetUserId,
      targetUserName,
      action,
    );
    const affectedUserIds = new Set(recurringResult.currentLeaderIds);

    if (recurringResult.leaderUserId) {
      affectedUserIds.add(recurringResult.leaderUserId);
    }

    await Promise.all([...affectedUserIds].map((userId) => syncLeaderRole(userId)));

    return {
      success: true,
      message: action === 'assign' ? '本学期固定班次班负已更新' : '已撤销本学期固定班次班负',
      slotScheduleCount: recurringResult.affectedScheduleCount,
      affectedDateSlotCount: recurringResult.affectedDateSlotCount,
      leaderUserId: recurringResult.leaderUserId,
      leaderUserName: recurringResult.leaderUserName,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
