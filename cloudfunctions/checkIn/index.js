// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, scheduleId, date } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const checkRecordsCollection = db.collection('checkRecords');
    const now = new Date();

    // 检查今日是否已签到
    const today = date || now.toISOString().split('T')[0];
    const existing = await checkRecordsCollection.where({
      userId,
      date: today,
    }).get();

    if (existing.data.length > 0) {
      return { success: false, error: '今日已签到' };
    }

    // 创建签到记录
    const result = await checkRecordsCollection.add({
      data: {
        userId,
        scheduleId,
        date: today,
        checkInTime: now,
        checkOutTime: null,
        overtimeHours: 0,
        overtimeApproved: false,
        attendanceStatus: 0, // 正常
        createdAt: now,
      }
    });

    return { success: true, recordId: result._id };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
