// 云函数入口文件 - 获取我的班次
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, semesterId, startDate, endDate } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const schedulesCollection = db.collection('schedules');

    // 构建查询条件
    let query = { userId };
    
    // 学期筛选
    if (semesterId) {
      query.semesterId = semesterId;
    }
    
    // 日期范围筛选
    if (startDate && endDate) {
      query.date = db.command.gte(startDate).and(db.command.lte(endDate));
    }

    // 查询班次列表
    const schedules = await schedulesCollection
      .where(query)
      .orderBy('date', 'asc')
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
