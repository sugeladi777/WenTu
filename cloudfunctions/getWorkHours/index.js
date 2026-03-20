// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, startDate, endDate } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const checkRecordsCollection = db.collection('checkRecords');
    const shiftsCollection = db.collection('shifts');

    // 查询日期范围内的签到记录
    let query = { userId };
    if (startDate && endDate) {
      query.date = db.command.gte(startDate).and(db.command.lte(endDate));
    }

    const records = await checkRecordsCollection.where(query).get();
    
    // 获取班次信息
    const shifts = await shiftsCollection.get();
    const shiftsMap = {};
    shifts.data.forEach(s => shiftsMap[s._id] = s);

    // 计算总工时
    let totalHours = 0;
    const list = records.data.map(record => {
      const shift = shiftsMap[record.shiftId] || { fixedHours: 0 };
      // 只有签退后且加班已审批的才计入工时
      const overtime = record.overtimeApproved ? record.overtimeHours : 0;
      const hours = record.checkOutTime ? (shift.fixedHours + overtime) : 0;
      totalHours += hours;
      return { ...record, hours, shiftName: shift.name };
    });

    return { success: true, totalHours, list };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
