// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, date, scheduleId, overtimeHours } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const checkRecordsCollection = db.collection('checkRecords');
    const today = date || new Date().toISOString().split('T')[0];

    // 构建查询条件
    const query = { userId, date: today };
    if (scheduleId) {
      query.scheduleId = scheduleId;
    }

    // 查找今日该班次的签到记录
    const existing = await checkRecordsCollection
      .where(query)
      .orderBy('checkInTime', 'desc')
      .get();

    if (existing.data.length === 0) {
      return { success: false, error: '今日未签到' };
    }

    // 找到第一个未签退的记录
    let recordToUpdate = null;
    for (const record of existing.data) {
      if (!record.checkOutTime) {
        recordToUpdate = record;
        break;
      }
    }

    if (!recordToUpdate) {
      return { success: false, error: '今日已签退' };
    }

    // 更新签退时间和加班时长
    const now = new Date();
    await checkRecordsCollection.doc(recordToUpdate._id).update({
      data: {
        checkOutTime: now,
        overtimeHours: overtimeHours || 0,
        overtimeApproved: false,
      }
    });

    return { success: true, message: '签退成功' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
