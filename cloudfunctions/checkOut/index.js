// 云函数入口文件 - 签退
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 获取北京时间
function getBeijingTime() {
  const now = new Date();
  const beijingOffset = 480; // 北京时区偏移（分钟）
  const localOffset = now.getTimezoneOffset();
  const offsetDiff = beijingOffset - (-localOffset);
  return new Date(now.getTime() + offsetDiff * 60 * 1000);
}

// 获取北京时间字符串（格式：2026-03-24 21:45:04）
function getBeijingTimeStr() {
  const now = getBeijingTime();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

exports.main = async (event, context) => {
  const { userId, date, scheduleId, overtimeHours } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const schedulesCollection = db.collection('schedules');
    const beijingTime = getBeijingTime();
    const today = date || `${beijingTime.getUTCFullYear()}-${String(beijingTime.getUTCMonth() + 1).padStart(2, '0')}-${String(beijingTime.getUTCDate()).padStart(2, '0')}`;

    // 构建查询条件
    const query = { userId, date: today };
    if (scheduleId) {
      query._id = scheduleId;
    }

    // 查找今日该班次
    const schedules = await schedulesCollection
      .where(query)
      .orderBy('startTime', 'asc')
      .get();

    if (schedules.data.length === 0) {
      return { success: false, error: '今日没有班次' };
    }

    // 找到第一个未签退的班次
    let scheduleToUpdate = null;
    for (const schedule of schedules.data) {
      if (schedule.checkInTime && !schedule.checkOutTime) {
        scheduleToUpdate = schedule;
        break;
      }
    }

    if (!scheduleToUpdate) {
      return { success: false, error: '今日已全部签退' };
    }

    // 更新签退时间和加班时长
    await schedulesCollection.doc(scheduleToUpdate._id).update({
      data: {
        checkOutTime: db.serverDate(),
        overtimeHours: overtimeHours || 0,
        overtimeApproved: false,
        updatedAt: db.serverDate(),
      }
    });

    return { success: true, message: '签退成功' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
