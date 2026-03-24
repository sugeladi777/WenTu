/**
 * 清空数据库
 * 清空所有集合的数据（用于测试）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const collections = [
      'users',
      // 'semesters',
      // 'shiftTemplates',
      'schedules',
      'weeklySelections',
      'shiftRequests',
      'rewards'
    ];

    const results = [];

    for (const name of collections) {
      try {
        const countRes = await db.collection(name).count();
        if (countRes.total > 0) {
          // 分批删除
          const BATCH_SIZE = 100;
          let deleted = 0;
          while (deleted < countRes.total) {
            const res = await db.collection(name)
              .limit(BATCH_SIZE)
              .get();
            
            if (res.data.length === 0) break;
            
            for (const doc of res.data) {
              await db.collection(name).doc(doc._id).remove();
              deleted++;
            }
          }
          results.push(`${name}: 删除${deleted}条`);
        } else {
          results.push(`${name}: 无数据`);
        }
      } catch (e) {
        results.push(`${name}: ${e.message}`);
      }
    }

    return { success: true, results };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
