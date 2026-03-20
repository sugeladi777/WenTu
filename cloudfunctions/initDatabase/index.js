// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 初始化数据库：创建集合和预设数据
exports.main = async (event, context) => {
  try {
    // 创建集合
    const collections = ['users', 'shifts', 'schedules', 'checkRecords', 'leaves', 'shiftChanges', 'rewards'];
    
    for (const name of collections) {
      try {
        await db.createCollection(name);
      } catch (e) {
        // 集合已存在，忽略错误
      }
    }

    // 预设班次数据
    const shiftsCollection = db.collection('shifts');
    const existingShifts = await shiftsCollection.count();
    
    if (existingShifts.total === 0) {
      await shiftsCollection.add({
        data: [
          { name: '早班', startTime: '08:00', endTime: '9:30', fixedHours: 1.5 },
          { name: '午班', startTime: '13:00', endTime: '15:00', fixedHours: 2 },
          { name: '晚一', startTime: '18:00', endTime: '20:00', fixedHours: 2 },
          { name: '晚二', startTime: '20:00', endTime: '22:00', fixedHours: 2 },
        ]
      });
    }

    return { success: true, message: '数据库初始化完成' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
