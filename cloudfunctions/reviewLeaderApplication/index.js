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

async function loadAllDocuments(collection, filter = {}) {
  const documents = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const result = await collection.where(filter).skip(offset).limit(pageSize).get();
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
    throw new Error('只有管理员可以审批班负申请');
  }

  return user;
}

function buildRecurringMatcher(record = {}) {
  const matcher = {
    semesterId: record.semesterId,
    dayOfWeek: Number(record.dayOfWeek),
  };

  if (record.shiftId) {
    matcher.shiftId = record.shiftId;
    return matcher;
  }

  matcher.startTime = record.startTime;
  matcher.endTime = record.endTime;
  return matcher;
}

function buildRecurringKey(record = {}) {
  const dayOfWeek = Number(record.dayOfWeek);
  if (record.shiftId) {
    return `${record.semesterId || ''}::${dayOfWeek}::${record.shiftId}`;
  }

  return `${record.semesterId || ''}::${dayOfWeek}::${record.startTime || ''}::${record.endTime || ''}`;
}

function buildDateSlotKey(schedule = {}) {
  if (schedule.shiftId) {
    return `${schedule.date || ''}::${schedule.shiftId}`;
  }

  return `${schedule.date || ''}::${schedule.startTime || ''}::${schedule.endTime || ''}`;
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

function buildReviewPayload(requesterId, reviewerName, status) {
  return {
    status,
    reviewedAt: db.serverDate(),
    reviewedBy: requesterId,
    reviewedByName: reviewerName,
    updatedAt: db.serverDate(),
  };
}

async function updateRecurringLeader(application, schedulesCollection = db.collection('schedules')) {
  const recurringSchedules = await loadAllDocuments(
    schedulesCollection,
    buildRecurringMatcher(application),
  );

  if (!recurringSchedules.length) {
    throw new Error('固定班次数据不存在');
  }

  const groupedByDateSlot = {};
  const currentLeaderIds = new Set();
  let targetHasOwnSchedule = false;
  let affectedScheduleCount = 0;
  let affectedDateSlotCount = 0;

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

  for (const slotSchedules of Object.values(groupedByDateSlot)) {
    const targetOwnSchedule = slotSchedules.find((item) => {
      return String(item.userId || '').trim() === String(application.userId || '').trim()
        && item.shiftType !== SHIFT_TYPE_LEAVE;
    });

    if (!targetOwnSchedule) {
      continue;
    }

    targetHasOwnSchedule = true;
    const nextLeaderUserId = String(application.userId || '').trim();
    const nextLeaderUserName = String(application.userName || '').trim();
    const shouldUpdate = slotSchedules.some((item) => {
      const currentLeaderUserId = String(item.leaderUserId || '').trim();
      const currentLeaderUserName = String(item.leaderUserName || '').trim();
      return currentLeaderUserId !== nextLeaderUserId || currentLeaderUserName !== nextLeaderUserName;
    });

    if (!shouldUpdate) {
      continue;
    }

    affectedDateSlotCount += 1;
    affectedScheduleCount += slotSchedules.length;

    await Promise.all(slotSchedules.map((item) => {
      return schedulesCollection.doc(item._id).update({
        data: {
          leaderUserId: nextLeaderUserId || null,
          leaderUserName: nextLeaderUserName || '',
          updatedAt: db.serverDate(),
        },
      });
    }));
  }

  if (!targetHasOwnSchedule) {
    throw new Error('申请人当前没有这个固定班次，无法审批为班负');
  }

  return {
    currentLeaderIds: [...currentLeaderIds],
    affectedScheduleCount,
    affectedDateSlotCount,
  };
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const applicationId = String(event.applicationId || '').trim();
  const action = String(event.action || '').trim();

  if (!requesterId || !applicationId || !action) {
    return { success: false, error: '参数错误' };
  }

  if (!['approve', 'reject'].includes(action)) {
    return { success: false, error: '不支持的操作' };
  }

  try {
    const admin = await ensureAdmin(requesterId);
    const reviewerName = String(admin.name || '').trim();
    const result = await db.runTransaction(async (transaction) => {
      const applicationCollection = transaction.collection('leaderApplications');
      const schedulesCollection = transaction.collection('schedules');
      const applicationResult = await applicationCollection.doc(applicationId).get();
      const application = applicationResult.data || null;

      if (!application) {
        throw new Error('申请记录不存在');
      }

      if (String(application.status || '') !== 'pending') {
        throw new Error('该申请已处理，请刷新后重试');
      }

      if (action === 'reject') {
        await applicationCollection.doc(applicationId).update({
          data: buildReviewPayload(requesterId, reviewerName, 'rejected'),
        });

        return {
          action,
          application,
        };
      }

      const siblingApplications = await loadAllDocuments(applicationCollection, {
        semesterId: application.semesterId,
        dayOfWeek: Number(application.dayOfWeek),
        ...(application.shiftId
          ? { shiftId: application.shiftId }
          : { startTime: application.startTime, endTime: application.endTime }),
      });
      const approvedSibling = siblingApplications.find((item) => {
        return String(item._id || '') !== applicationId && String(item.status || '') === 'approved';
      });

      if (approvedSibling) {
        throw new Error('该固定班次已有申请被审批，请刷新后重试');
      }

      const recurringResult = await updateRecurringLeader(application, schedulesCollection);
      await applicationCollection.doc(applicationId).update({
        data: buildReviewPayload(requesterId, reviewerName, 'approved'),
      });

      const otherPendingApplications = siblingApplications.filter((item) => {
        return String(item._id || '') !== applicationId && String(item.status || '') === 'pending';
      });

      for (const item of otherPendingApplications) {
        await applicationCollection.doc(item._id).update({
          data: buildReviewPayload(requesterId, reviewerName, 'rejected'),
        });
      }

      return {
        action,
        application,
        recurringResult,
        slotKey: buildRecurringKey(application),
      };
    });

    if (result.action === 'reject') {
      return {
        success: true,
        message: '已拒绝班负申请',
      };
    }

    const affectedUserIds = new Set(result.recurringResult.currentLeaderIds);
    affectedUserIds.add(String(result.application.userId || '').trim());
    await Promise.all([...affectedUserIds].map((userId) => syncLeaderRole(userId)));

    return {
      success: true,
      message: '班负申请已审批通过',
      affectedScheduleCount: result.recurringResult.affectedScheduleCount,
      affectedDateSlotCount: result.recurringResult.affectedDateSlotCount,
      slotKey: result.slotKey,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
