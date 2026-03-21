// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 初始化数据库：创建集合
exports.main = async (event, context) => {
  try {
    // 创建集合
    const collections = ['users', 'schedules', 'checkRecords', 'leaves', 'shiftChanges', 'rewards'];
    
    for (const name of collections) {
      try {
        await db.createCollection(name);
      } catch (e) {
        // 集合已存在，忽略错误
      }
    }

    return { success: true, message: '数据库初始化完成' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
