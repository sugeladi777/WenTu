// 云函数入口文件
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
    const shiftsCollection = db.collection('shifts');
    const checkRecordsCollection = db.collection('checkRecords');

    const today = date || new Date().toISOString().split('T')[0];

    // 查找今日排班
    const schedules = await schedulesCollection.where({
      userId,
      date: today,
    }).get();

    if (schedules.data.length === 0) {
      return { success: true, schedule: null };
    }

    const schedule = schedules.data[0];

    // 获取班次详情
    const shift = await shiftsCollection.doc(schedule.shiftId).get();

    // 获取签到记录
    const checkRecord = await checkRecordsCollection.where({
      userId,
      date: today,
    }).get();

    return {
      success: true,
      schedule: {
        ...schedule,
        shift: shift.data,
      },
      checkRecord: checkRecord.data[0] || null,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
