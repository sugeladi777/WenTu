// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const today = new Date().toISOString().split('T')[0];

    // 获取今日班次
    const schedule = await db.collection('schedules')
      .where({
        userId,
        date: today,
      })
      .get();

    if (schedule.data.length === 0) {
      return { success: true, schedule: null };
    }

    return { success: true, schedule: schedule.data[0] };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
