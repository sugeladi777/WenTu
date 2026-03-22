/**
 * 获取我的班次
 * 获取用户的所有班次记录
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, startDate, endDate } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const query = { userId };
    
    // 可选：按日期范围筛选
    if (startDate && endDate) {
      query.date = db.command.and(
        db.command.gte(startDate),
        db.command.lte(endDate)
      );
    } else if (startDate) {
      query.date = db.command.gte(startDate);
    }

    const res = await db.collection('schedules')
      .where(query)
      .orderBy('date', 'asc')
      .orderBy('startTime', 'asc')
      .limit(500)  // 添加限制防止数据过多
      .get();

    // 打印日志用于调试
    console.log('查询条件:', query);
    console.log('查询结果数量:', res.data.length);
    console.log('数据示例:', JSON.stringify(res.data.slice(0, 5)));

    return { success: true, shifts: res.data || [] };
  } catch (e) {
    console.error('查询失败:', e);
    return { success: false, error: e.message };
  }
};
