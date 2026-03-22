/**
 * 获取班次容量
 * 基于 weeklySelections 统计每个班次的当前选择人数
 */
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

    // 获取所有周选择记录
    const selections = await db.collection('weeklySelections')
      .where({ semesterId })
      .get();

    // 构建容量映射: key = shiftId_dayOfWeek
    const capacityMap = {};
    
    templates.data.forEach(t => {
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

    // 统计每个 shiftId + dayOfWeek 的人数
    selections.data.forEach(selection => {
      if (selection.preferences && Array.isArray(selection.preferences)) {
        selection.preferences.forEach(pref => {
          const key = `${pref.shiftId}_${pref.dayOfWeek}`;
          if (capacityMap[key]) {
            capacityMap[key].currentCount++;
            capacityMap[key].remaining = capacityMap[key].maxCapacity - capacityMap[key].currentCount;
          }
        });
      }
    });

    const capacityList = Object.values(capacityMap);
    return { success: true, capacityList };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
