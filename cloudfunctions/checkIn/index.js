// 云函数入口文件 - 签到
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 班次类型常量
const SHIFT_TYPE_NORMAL = 0;   // 正常
const SHIFT_TYPE_LEAVE = 1;    // 请假
const SHIFT_TYPE_SWAP = 2;    // 替班
const SHIFT_TYPE_BORROW = 3;  // 蹭班

// 考勤状态常量
const ATTENDANCE_NORMAL = 0;   // 正常
const ATTENDANCE_LATE = 1;     // 迟到
const ATTENDANCE_ABSENT = 3;  // 旷岗

// 获取北京时间（考虑时区偏移）
function getBeijingTime() {
  const now = new Date();
  // 获取本地时区偏移（分钟），微信云函数环境可能是 UTC
  // 中国时区是 +8 小时 = 480 分钟
  const beijingOffset = 480; // 分钟
  const localOffset = now.getTimezoneOffset(); // 本地时区偏移（可能是0或负值）
  const offsetDiff = beijingOffset - (-localOffset); // 计算差值
  
  return new Date(now.getTime() + offsetDiff * 60 * 1000);
}

// 获取北京时间字符串（格式：YYYY-MM-DDTHH:mm:ss.sssZ）
function getBeijingISODate() {
  const now = getBeijingTime();
  // 手动构建 UTC 格式的时间字符串
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  const ms = String(now.getUTCMilliseconds()).padStart(3, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}Z`;
}

exports.main = async (event, context) => {
  const { userId, date, scheduleId, latitude, longitude } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const schedulesCollection = db.collection('schedules');
    // 使用北京时间
    const beijingTime = getBeijingTime();
    const today = date || `${beijingTime.getUTCFullYear()}-${String(beijingTime.getUTCMonth() + 1).padStart(2, '0')}-${String(beijingTime.getUTCDate()).padStart(2, '0')}`;

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
          if (!s.checkInTime) {
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

    // 检查是否已签到
    if (schedule.checkInTime) {
      return { success: false, error: '该班次已签到' };
    }

    // 检查是否是请假状态（请假不能签到）
    if (schedule.shiftType === SHIFT_TYPE_LEAVE && schedule.leaveStatus === 1) {
      return { success: false, error: '该班次已请假，不能签到' };
    }

    // 使用北京时间解析班次时间
    const shiftStartTime = new Date(today + 'T' + schedule.startTime + ':00');
    const shiftEndTime = new Date(today + 'T' + schedule.endTime + ':00');

    // 签到时间验证：
    // 班次开始前15分钟到班次结束前都可以签到
    const earliestTime = new Date(shiftStartTime.getTime() - 15 * 60 * 1000);

    if (beijingTime < earliestTime) {
      return { success: false, error: `请在 ${formatTime(earliestTime)} 后签到` };
    }

    if (beijingTime > shiftEndTime) {
      return { success: false, error: '已超过班次时间，不能签到' };
    }

    // 确定考勤状态
    // 班次开始5分钟后签到视为迟到
    const lateThreshold = new Date(shiftStartTime.getTime() + 5 * 60 * 1000);
    let attendanceStatus = ATTENDANCE_NORMAL;
    if (beijingTime > lateThreshold) {
      attendanceStatus = ATTENDANCE_LATE; // 迟到
    }

    // 获取北京时间的 ISO 字符串用于存储
    const checkInTimeStr = getBeijingISODate();

    // 更新 schedules 表
    await schedulesCollection.doc(schedule._id).update({
      data: {
        checkInTime: db.serverDate(), // 使用服务端时间
        attendanceStatus,
        checkInLocation: latitude && longitude ? { latitude, longitude } : null,
        updatedAt: db.serverDate(),
      }
    });

    const statusMsg = attendanceStatus === ATTENDANCE_NORMAL ? '签到成功' : '签到成功（迟到）';
    return { success: true, scheduleId: schedule._id, status: statusMsg };
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
