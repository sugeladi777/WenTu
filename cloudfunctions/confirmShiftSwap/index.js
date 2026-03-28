const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const SHIFT_TYPE_LEAVE = 1;
const SHIFT_TYPE_SWAP = 2;
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

async function clearSlotLeader(schedule) {
  const slotResult = await db.collection('schedules')
    .where(buildSlotMatcher(schedule))
    .limit(100)
    .get();

  await Promise.all((slotResult.data || []).map((item) => {
    return db.collection('schedules').doc(item._id).update({
      data: {
        leaderUserId: null,
        leaderUserName: '',
        updatedAt: db.serverDate(),
      },
    });
  }));
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

exports.main = async (event) => {
  const requestId = String(event.requestId || '').trim();
  const action = String(event.action || '').trim();
  const approverId = String(event.approverId || '').trim();
  const approverName = String(event.approverName || '').trim();

  if (!requestId || !action) {
    return { success: false, error: '参数错误' };
  }

  try {
    const shiftRequestsCollection = db.collection('shiftRequests');
    const schedulesCollection = db.collection('schedules');
    const requestResult = await shiftRequestsCollection.doc(requestId).get();
    const request = requestResult.data || null;

    if (!request) {
      return { success: false, error: '申请不存在' };
    }

    if (request.status !== 'pending') {
      return { success: false, error: '该申请已处理' };
    }

    if (action === 'accept') {
      const fromScheduleResult = await schedulesCollection.doc(request.fromScheduleId).get();
      const toScheduleResult = await schedulesCollection.doc(request.toScheduleId).get();
      const fromSchedule = fromScheduleResult.data || null;
      const toSchedule = toScheduleResult.data || null;

      if (!fromSchedule || !toSchedule) {
        return { success: false, error: '班次不存在' };
      }

      if (fromSchedule.checkInTime || fromSchedule.checkOutTime || toSchedule.checkInTime || toSchedule.checkOutTime) {
        return { success: false, error: '班次已产生考勤记录，不能调班' };
      }

      const fromOwnerId = String(fromSchedule.userId || '').trim();
      const toOwnerId = String(toSchedule.userId || '').trim();
      const clearFromSlotLeader = String(fromSchedule.leaderUserId || '').trim() === fromOwnerId && !!fromOwnerId;
      const clearToSlotLeader = String(toSchedule.leaderUserId || '').trim() === toOwnerId && !!toOwnerId;

      await schedulesCollection.doc(request.fromScheduleId).update({
        data: {
          userId: request.toUserId,
          userName: request.toUserName,
          originalUserId: request.fromUserId,
          shiftType: SHIFT_TYPE_SWAP,
          updatedAt: db.serverDate(),
        },
      });

      await schedulesCollection.doc(request.toScheduleId).update({
        data: {
          userId: request.fromUserId,
          userName: request.fromUserName,
          originalUserId: request.toUserId,
          shiftType: SHIFT_TYPE_SWAP,
          updatedAt: db.serverDate(),
        },
      });

      if (clearFromSlotLeader) {
        await clearSlotLeader(fromSchedule);
      }

      if (clearToSlotLeader) {
        await clearSlotLeader(toSchedule);
      }

      await shiftRequestsCollection.doc(requestId).update({
        data: {
          status: 'accepted',
          approverId,
          approverName,
          approvedAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });

      const affectedUsers = new Set();
      if (clearFromSlotLeader) {
        affectedUsers.add(fromOwnerId);
      }
      if (clearToSlotLeader) {
        affectedUsers.add(toOwnerId);
      }
      await Promise.all([...affectedUsers].map((userId) => syncLeaderRole(userId)));

      return { success: true, message: '调班成功' };
    }

    await shiftRequestsCollection.doc(requestId).update({
      data: {
        status: 'rejected',
        approverId,
        approverName,
        approvedAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });

    return { success: true, message: '已拒绝调班' };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
