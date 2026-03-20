// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, date, overtimeHours } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const checkRecordsCollection = db.collection('checkRecords');
    const today = date || new Date().toISOString().split('T')[0];

    // 查找今日签到记录
    const existing = await checkRecordsCollection.where({
      userId,
      date: today,
    }).get();

    if (existing.data.length === 0) {
      return { success: false, error: '今日未签到' };
    }

    if (existing.data[0].checkOutTime) {
      return { success: false, error: '今日已签退' };
    }

    // 更新签退时间和加班时长
    const now = new Date();
    await checkRecordsCollection.doc(existing.data[0]._id).update({
      data: {
        checkOutTime: now,
        overtimeHours: overtimeHours || 0,
        overtimeApproved: false, // 加班需班负审批
      }
    });

    return { success: true, message: '签退成功' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
