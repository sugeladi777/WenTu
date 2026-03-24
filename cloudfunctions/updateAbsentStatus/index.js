/**
 * 更新旷岗状态
 * 定时任务：检查并更新已过班次结束时间但未签到的班次为旷岗
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 考勤状态常量
const ATTENDANCE_NORMAL = 0;   // 正常
const ATTENDANCE_LATE = 1;     // 迟到
const ATTENDANCE_ABSENT = 3;  // 旷岗

exports.main = async (event, context) => {
  try {
    const schedulesCollection = db.collection('schedules');
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // 获取今天的日期部分
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // 查询条件：
    // 1. date 为今天
    // 2. 未签到 (checkInTime 不存在)
    // 3. 班次已结束（根据 endTime 判断）
    // 4. 状态还不是旷岗
    const schedules = await schedulesCollection
      .where({
        date: today,
        checkInTime: null,
      })
      .field({
        _id: true,
        endTime: true,
        attendanceStatus: true,
      })
      .get();

    let updatedCount = 0;

    for (const schedule of schedules.data) {
      // 解析班次结束时间
      const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
      
      // 将结束时间转换为今天的分钟数
      const endMinutes = endHour * 60 + endMinute;
      const currentMinutes = currentHour * 60 + currentMinute;
      
      // 判断班次是否已结束（结束时间 + 1小时宽限期）
      const latestCheckInMinutes = endMinutes + 60;
      
      if (currentMinutes > latestCheckInMinutes) {
        // 超过宽限期，更新为旷岗
        await schedulesCollection.doc(schedule._id).update({
          data: {
            attendanceStatus: ATTENDANCE_ABSENT,
            updatedAt: now,
          }
        });
        updatedCount++;
      }
    }

    return {
      success: true,
      message: `已更新 ${updatedCount} 条旷岗记录`,
      updatedCount,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
