// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, scheduleId, date, latitude, longitude } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const checkRecordsCollection = db.collection('checkRecords');
    const schedulesCollection = db.collection('schedules');
    const now = new Date();

    // 检查今日是否已签到
    const today = date || now.toISOString().split('T')[0];
    const existing = await checkRecordsCollection.where({
      userId,
      date: today,
    }).get();

    if (existing.data.length > 0) {
      return { success: false, error: '今日已签到' };
    }

    // 获取今日排班信息
    const schedules = await schedulesCollection.where({
      userId,
      date: today,
    }).get();

    let shiftStartTime = null;

    if (schedules.data.length > 0) {
      const schedule = schedules.data[0];
      // 解析班次时间
      const [startHour, startMin] = (schedule.startTime || '08:00').split(':');
      shiftStartTime = new Date(today);
      shiftStartTime.setHours(parseInt(startHour), parseInt(startMin), 0, 0);
    }

    // 验证时间（班次前5分钟到班次结束后）
    if (shiftStartTime) {
      const earliestTime = new Date(shiftStartTime.getTime() - 5 * 60 * 1000);
      
      if (now < earliestTime) {
        return { success: false, error: `请在 ${formatTime(earliestTime)} 后签到` };
      }
    }

    // 确定考勤状态
    let attendanceStatus = 0; // 正常
    if (shiftStartTime) {
      if (now > shiftStartTime) {
        attendanceStatus = 1; // 迟到
      }
    }

    // 创建签到记录
    const result = await checkRecordsCollection.add({
      data: {
        userId,
        scheduleId,
        date: today,
        checkInTime: now,
        checkOutTime: null,
        overtimeHours: 0,
        overtimeApproved: false,
        attendanceStatus, // 0:正常, 1:迟到
        // 位置信息暂时不验证，可选择性保存
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
