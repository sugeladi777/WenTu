// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { semesterId } = event;

  if (!semesterId) {
    return { success: false, error: '学期ID不能为空' };
  }

  try {
    // 获取所有班次模板
    const templates = await db.collection('shiftTemplates')
      .where({ semesterId })
      .get();

    // 获取该学期所有已选择的班次
    const schedules = await db.collection('schedules')
      .where({ semesterId })
      .get();

    // 构建容量映射: key = shiftId_dayOfWeek
    // 统计每周的某天某班次有多少人选择（按 userId 去重）
    const capacityMap = {};
    
    templates.data.forEach(t => {
      // 每个班次模板初始化7天的容量
      for (let day = 0; day < 7; day++) {
        const key = `${t._id}_${day}`;
        capacityMap[key] = {
          shiftId: t._id,
          dayOfWeek: day,
          maxCapacity: t.maxCapacity,
          currentCount: 0,
          remaining: t.maxCapacity,
        };
      }
    });

    // 统计（只统计状态为normal的，并且按 userId 去重）
    const userCountMap = {}; // key = shiftId_dayOfWeek, value = Set of userIds
    
    schedules.data.forEach(s => {
      if (s.status === 'normal') {
        const key = `${s.shiftId}_${s.dayOfWeek}`;
        if (!userCountMap[key]) {
          userCountMap[key] = new Set();
        }
        userCountMap[key].add(s.userId);
      }
    });

    // 更新 currentCount 为实际人数
    Object.keys(userCountMap).forEach(key => {
      if (capacityMap[key]) {
        capacityMap[key].currentCount = userCountMap[key].size;
        capacityMap[key].remaining = capacityMap[key].maxCapacity - userCountMap[key].size;
      }
    });

    // 转换为数组
    const capacityList = Object.values(capacityMap);

    return { success: true, capacityList };
  } catch (err) {
    return { success: false, error: err.message };
  }
};
