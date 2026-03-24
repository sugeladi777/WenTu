// 云函数入口文件 - 签退
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, date, scheduleId, overtimeHours } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const schedulesCollection = db.collection('schedules');
    const today = date || new Date().toISOString().split('T')[0];

    // 构建查询条件
    const query = { userId, date: today };
    if (scheduleId) {
      query._id = scheduleId;
    }

    // 查找今日该班次
    const schedules = await schedulesCollection
      .where(query)
      .orderBy('startTime', 'asc')
      .get();

    if (schedules.data.length === 0) {
      return { success: false, error: '今日没有班次' };
    }

    // 找到第一个未签退的班次
    let scheduleToUpdate = null;
    for (const schedule of schedules.data) {
      if (schedule.checkInTime && !schedule.checkOutTime) {
        scheduleToUpdate = schedule;
        break;
      }
    }

    if (!scheduleToUpdate) {
      return { success: false, error: '今日已全部签退' };
    }

    // 更新签退时间和加班时长
    const now = new Date();
    await schedulesCollection.doc(scheduleToUpdate._id).update({
      data: {
        checkOutTime: now,
        overtimeHours: overtimeHours || 0,
        overtimeApproved: false,
        updatedAt: now,
      }
    });

    return { success: true, message: '签退成功' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
