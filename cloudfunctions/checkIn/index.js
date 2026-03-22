// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, date, scheduleId, latitude, longitude } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const checkRecordsCollection = db.collection('checkRecords');
    const schedulesCollection = db.collection('schedules');
    const now = new Date();
    const today = date || now.toISOString().split('T')[0];

    // 检查今日是否已签到（针对指定班次）
    const existing = await checkRecordsCollection.where({
      userId,
      date: today,
      scheduleId: scheduleId,
    }).get();

    if (existing.data.length > 0) {
      return { success: false, error: '该班次已签到' };
    }

    // 获取指定班次
    let schedule = null;
    if (scheduleId) {
      const scheduleRes = await schedulesCollection.doc(scheduleId).get();
      schedule = scheduleRes.data;
    } else {
      // 如果没有指定班次ID，获取今日所有班次
      const schedules = await schedulesCollection
        .where({ userId, date: today })
        .orderBy('startTime', 'asc')
        .get();
      
      if (schedules.data.length > 0) {
        // 自动选择第一个未签到的班次
        for (const s of schedules.data) {
          const check = await checkRecordsCollection.where({
            userId,
            date: today,
            scheduleId: s._id
          }).count();
          
          if (check.total === 0) {
            schedule = s;
            break;
          }
        }
        
        if (!schedule) {
          return { success: false, error: '今日所有班次已签到' };
        }
      }
    }

    // 必须有班次才能签到
    if (!schedule) {
      return { success: false, error: '今日没有班次' };
    }

    const shiftStartTime = new Date(today + 'T' + schedule.startTime + ':00');
    const shiftEndTime = new Date(today + 'T' + schedule.endTime + ':00');

    // 签到时间验证：班次开始前15分钟到班次结束后30分钟内可以签到
    const earliestTime = new Date(shiftStartTime.getTime() - 15 * 60 * 1000);
    const latestTime = new Date(shiftEndTime.getTime() + 30 * 60 * 1000);

    if (now < earliestTime) {
      return { success: false, error: `请在 ${formatTime(earliestTime)} 后签到` };
    }

    if (now > latestTime) {
      return { success: false, error: '已超过签到时间' };
    }

    // 确定考勤状态
    let attendanceStatus = 0; // 正常
    if (now > shiftStartTime) {
      attendanceStatus = 1; // 迟到
    }

    // 创建签到记录
    const result = await checkRecordsCollection.add({
      data: {
        userId,
        scheduleId: schedule._id,
        shiftName: schedule.shiftName,
        date: today,
        checkInTime: now,
        checkOutTime: null,
        overtimeHours: 0,
        overtimeApproved: false,
        attendanceStatus,
        checkInLocation: latitude && longitude ? { latitude, longitude } : null,
        createdAt: now,
      }
    });

    const statusMsg = attendanceStatus === 0 ? '签到成功' : '签到成功（迟到）';
    return { success: true, recordId: result._id, status: statusMsg };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

// 格式化时间
function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
