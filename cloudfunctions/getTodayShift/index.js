// 云函数入口文件 - 获取今日班次
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, date } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const schedulesCollection = db.collection('schedules');
    const today = date || new Date().toISOString().split('T')[0];

    // 查询今日该用户的所有班次
    const schedules = await schedulesCollection
      .where({ 
        userId,
        date: today
      })
      .orderBy('startTime', 'asc')
      .get();

    return { 
      success: true, 
      schedules: schedules.data || [],
      count: schedules.data ? schedules.data.length : 0
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
