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

    // 查询所有班次（不管是否签退）
    const schedules = await schedulesCollection.where(query).orderBy('date', 'desc').get();
    
    // 计算总工时（只计入正常或迟到的已签退班次）
    let totalHours = 0;
    const list = schedules.data.map(schedule => {
      // 只有签退且考勤状态为正常(0)或迟到(1)才计入工时
      const isValid = schedule.checkOutTime && 
                      (schedule.attendanceStatus === 0 || schedule.attendanceStatus === 1);
      
      const baseHours = isValid ? (schedule.fixedHours || 0) : 0;
      const overtimeHours = (isValid && schedule.overtimeApproved) ? (schedule.overtimeHours || 0) : 0;
      const hours = baseHours + overtimeHours;
      
      if (isValid) {
        totalHours += hours;
      }
      
      return { 
        ...schedule, 
        hours: Math.round(hours * 100) / 100,
        shiftHours: baseHours,
        overtimeHours: overtimeHours,
        isValid: isValid,
        isPaid: schedule.salaryPaid || false,
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
