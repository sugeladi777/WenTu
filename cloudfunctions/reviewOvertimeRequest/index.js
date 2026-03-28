const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];
const SHIFT_TYPE_LEAVE = 1;

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

async function ensureRequester(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user) {
    throw new Error('请求用户不存在');
  }

  return user;
}

exports.main = async (event = {}) => {
  const requesterId = String(event.requesterId || '').trim();
  const requesterName = String(event.requesterName || '').trim();
  const scheduleId = String(event.scheduleId || '').trim();
  const action = String(event.action || '').trim();

  if (!requesterId || !scheduleId || !action) {
    return { success: false, error: '参数错误' };
  }

  if (!['approve', 'reject'].includes(action)) {
    return { success: false, error: '不支持的审批动作' };
  }

  try {
    const requester = await ensureRequester(requesterId);
    const scheduleResult = await db.collection('schedules').doc(scheduleId).get();
    const schedule = scheduleResult.data || null;

    if (!schedule) {
      return { success: false, error: '班次记录不存在' };
    }

    if (schedule.shiftType === SHIFT_TYPE_LEAVE) {
      return { success: false, error: '请假班次无需审批加班' };
    }

    if (!schedule.checkOutTime) {
      return { success: false, error: '该班次尚未签退，不能审批加班' };
    }

    if (!Number(schedule.overtimeHours || 0) || schedule.overtimeStatus !== 'pending') {
      return { success: false, error: '当前没有待审批的加班申请' };
    }

    if (schedule.salaryPaid) {
      return { success: false, error: '该班次工资已发放，不能再审批加班' };
    }

    const isAdmin = hasRole(requester, ROLE_ADMIN);
    if (!isAdmin && String(schedule.leaderUserId || '').trim() !== requesterId) {
      return { success: false, error: '只有当前班次班负才能审批加班' };
    }

    await db.collection('schedules').doc(scheduleId).update({
      data: {
        overtimeApproved: action === 'approve',
        overtimeStatus: action === 'approve' ? 'approved' : 'rejected',
        overtimeReviewedAt: db.serverDate(),
        overtimeReviewedBy: requesterId,
        overtimeReviewedByName: requesterName || requester.name || '',
        updatedAt: db.serverDate(),
      },
    });

    const updatedResult = await db.collection('schedules').doc(scheduleId).get();

    return {
      success: true,
      message: action === 'approve' ? '加班申请已通过' : '加班申请已驳回',
      schedule: updatedResult.data || null,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
