// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, startDate, endDate, semesterId } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const checkRecordsCollection = db.collection('checkRecords');
    const schedulesCollection = db.collection('schedules');

    // 查询日期范围内的签到记录
    let query = { userId };
    if (startDate && endDate) {
      query.date = db.command.gte(startDate).and(db.command.lte(endDate));
    }

    const records = await checkRecordsCollection.where(query).get();
    
    // 获取用户的班次信息
    let scheduleQuery = { userId };
    if (semesterId) {
      scheduleQuery.semesterId = semesterId;
    }
    const schedules = await schedulesCollection.where(scheduleQuery).get();
    
    // 构建班次映射
    const scheduleMap = {};
    schedules.data.forEach(s => {
      scheduleMap[s.date] = s;
    });

    // 计算总工时
    let totalHours = 0;
    const list = records.data.map(record => {
      // 使用固定工时计算
      let shiftHours = 0;
      let shiftName = record.shiftName || '未排班';
      
      const schedule = scheduleMap[record.date];
      if (schedule) {
        shiftName = schedule.shiftName;
        shiftHours = schedule.fixedHours || 2; // 使用固定工时
      }
      
      // 只有签退后且加班已审批的才计入工时
      const overtime = record.overtimeApproved ? record.overtimeHours : 0;
      const hours = record.checkOutTime ? (shiftHours + overtime) : 0;
      totalHours += hours;
      
      return { 
        ...record, 
        hours: Math.round(hours * 100) / 100,
        shiftHours: Math.round(shiftHours * 100) / 100,
        shiftName 
      };
    });

    return { success: true, totalHours: Math.round(totalHours * 100) / 100, list };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
