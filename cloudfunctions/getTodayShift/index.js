/**
 * 获取今日班次
 */
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

    const res = await db.collection('schedules')
      .where({ userId, date: today })
      .orderBy('startTime', 'asc')
      .get();

    return { success: true, schedules: res.data || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
