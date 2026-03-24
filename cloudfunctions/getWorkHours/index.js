// 云函数入口文件 - 获取工时统计
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, startDate, endDate, semesterId } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const schedulesCollection = db.collection('schedules');

    // 构建查询条件
    let query = { userId };
    
    // 日期范围筛选
    if (startDate && endDate) {
      query.date = db.command.gte(startDate).and(db.command.lte(endDate));
    }
    
    // 学期筛选
    if (semesterId) {
      query.semesterId = semesterId;
    }

    // 查询已签退的班次（只有签退后才能计入工时）
    query.checkOutTime = db.command.exists(true);

    const schedules = await schedulesCollection.where(query).orderBy('date', 'desc').get();
    
    // 计算总工时
    let totalHours = 0;
    const list = schedules.data.map(schedule => {
      // 计算工时 = 固定工时 + 加班工时（需审批通过）
      const baseHours = schedule.fixedHours || 0;
      const overtimeHours = schedule.overtimeApproved ? (schedule.overtimeHours || 0) : 0;
      const hours = baseHours + overtimeHours;
      totalHours += hours;
      
      return { 
        ...schedule, 
        hours: Math.round(hours * 100) / 100,
        shiftHours: baseHours,
        overtimeHours: overtimeHours,
      };
    });

    return { 
      success: true, 
      totalHours: Math.round(totalHours * 100) / 100, 
      list,
      count: list.length
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
