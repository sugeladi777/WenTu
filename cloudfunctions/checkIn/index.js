// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 图书馆固定位置坐标
const LIBRARY_LOCATION = {
  latitude: 40.00429438366638,
  longitude: 116.32847291187238,
  name: '图书馆'
};

// 签到有效范围（米）
const CHECK_IN_RANGE = 50;

// 计算两点之间的距离（单位：米）
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

exports.main = async (event, context) => {
  const { userId, scheduleId, date, latitude, longitude } = event;

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const checkRecordsCollection = db.collection('checkRecords');
    const schedulesCollection = db.collection('schedules');
    const shiftsCollection = db.collection('shifts');
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

    // 获取今日排班和班次信息
    const schedules = await schedulesCollection.where({
      userId,
      date: today,
    }).get();

    let shiftStartTime = null;
    let shiftEndTime = null;

    if (schedules.data.length > 0) {
      const schedule = schedules.data[0];
      const shift = await shiftsCollection.doc(schedule.shiftId).get();
      
      if (shift.data) {
        // 解析班次时间
        const [startHour, startMin] = (shift.data.startTime || '08:00').split(':');
        const [endHour, endMin] = (shift.data.endTime || '22:00').split(':');
        
        shiftStartTime = new Date(today);
        shiftStartTime.setHours(parseInt(startHour), parseInt(startMin), 0, 0);
        
        shiftEndTime = new Date(today);
        shiftEndTime.setHours(parseInt(endHour), parseInt(endMin), 0, 0);
      }
    }

    // 验证时间（班次前5分钟到班次结束后）
    if (shiftStartTime) {
      const earliestTime = new Date(shiftStartTime.getTime() - 5 * 60 * 1000); // 提前5分钟
      
      if (now < earliestTime) {
        return { success: false, error: `请在 ${formatTime(earliestTime)} 后签到` };
      }
    }

    // 验证位置（必须在图书馆50米内）
    if (latitude && longitude) {
      const distance = calculateDistance(
        latitude, 
        longitude, 
        LIBRARY_LOCATION.latitude, 
        LIBRARY_LOCATION.longitude
      );
      
      if (distance > CHECK_IN_RANGE) {
        return { 
          success: false, 
          error: `请在${LIBRARY_LOCATION.name}50米范围内签到（当前距离：${Math.round(distance)}米）` 
        };
      }
    } else {
      return { success: false, error: '无法获取位置信息，请检查定位权限' };
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
        checkInLocation: latitude && longitude ? { latitude, longitude } : null,
        distance: calculateDistance(
          latitude,
          longitude,
          LIBRARY_LOCATION.latitude,
          LIBRARY_LOCATION.longitude
        ),
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
