// 云函数入口文件 - 申请请假
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 请假状态常量
const LEAVE_STATUS_PENDING = 0;   // 待审批
const LEAVE_STATUS_APPROVED = 1;  // 已批准
const LEAVE_STATUS_REJECTED = 2;  // 已拒绝

exports.main = async (event, context) => {
  const { userId, scheduleId, reason } = event;

  if (!userId || !scheduleId) {
    return { success: false, error: '参数不完整' };
  }

  try {
    const schedulesCollection = db.collection('schedules');

    // 获取班次信息
    const scheduleRes = await schedulesCollection.doc(scheduleId).get();
    if (!scheduleRes.data) {
      return { success: false, error: '班次不存在' };
    }

    const schedule = scheduleRes.data;

    // 检查是否是本人的班次
    if (schedule.userId !== userId) {
      return { success: false, error: '只能申请自己的班次请假' };
    }

    // 检查是否已经请假
    if (schedule.shiftType === 1) {
      return { success: false, error: '该班次已经申请过请假' };
    }

    // 检查是否已签到
    if (schedule.checkInTime) {
      return { success: false, error: '该班次已签到，不能申请请假' };
    }

    const now = new Date();

    // 更新 schedules 表的请假字段
    await schedulesCollection.doc(scheduleId).update({
      data: {
        shiftType: 1,  // 请假状态
        leaveReason: reason || '',
        leaveStatus: LEAVE_STATUS_PENDING,
        updatedAt: now,
      }
    });

    return { success: true, message: '请假申请已提交' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
