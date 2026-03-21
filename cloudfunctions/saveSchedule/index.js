// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, schedules } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  if (!schedules || !Array.isArray(schedules)) {
    return { success: false, error: '班次数据格式错误' };
  }

  try {
    const schedulesCollection = db.collection('schedules');

    // 添加新的排班
    const tasks = schedules.map(schedule => {
      return schedulesCollection.add({
        data: {
          userId,
          shiftId: schedule.shiftId,
          shiftName: schedule.shiftName,
          date: schedule.date,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          shiftLeaderId: null,
          createdAt: new Date(),
        }
      });
    });

    await Promise.all(tasks);

    return { success: true, message: '班次保存成功' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
