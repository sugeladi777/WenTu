// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 初始化数据库：创建集合
exports.main = async (event, context) => {
  try {
    // 创建集合
    const collections = [
      'users',           // 用户表
      'semesters',       // 学期表
      'shiftTemplates',  // 班次模板
      'schedules',       // 班次表
      'shiftRequests',   // 调班申请
      'checkRecords',    // 签到记录
      'leaves',          // 请假记录
    ];
    
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
