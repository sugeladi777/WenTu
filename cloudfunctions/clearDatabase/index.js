// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const collections = [
      'schedules',
      'shiftRequests',
      'checkRecords',
      'leaves',
      // 'shiftTemplates',
      // 'semesters',
      'users'
    ];

    const results = [];

    for (const name of collections) {
      try {
        // 删除集合中的所有记录
        const count = await db.collection(name).count();
        if (count.total > 0) {
          // 分批删除
          while (true) {
            const records = await db.collection(name).limit(100).get();
            if (records.data.length === 0) break;
            
            for (const record of records.data) {
              await db.collection(name).doc(record._id).remove();
            }
          }
        }
        results.push({ collection: name, status: 'cleared' });
      } catch (e) {
        results.push({ collection: name, status: 'error', message: e.message });
      }
    }

    return { success: true, results };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
