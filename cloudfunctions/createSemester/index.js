// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const name = event.name || '';
    const startDate = event.startDate || '';
    const endDate = event.endDate || '';
    
    if (!name || !startDate || !endDate) {
      return { success: false, error: '参数不完整' };
    }

    // 检查重叠
    const existing = await db.collection('semesters')
      .where({
        status: 'active',
        startDate: db.command.lte(endDate),
        endDate: db.command.gte(startDate)
      })
      .get();

    if (existing.data && existing.data.length > 0) {
      return { success: false, error: '该时间段与已有学期重叠' };
    }

    const result = await db.collection('semesters').add({
      data: {
        name: String(name),
        startDate: String(startDate),
        endDate: String(endDate),
        status: 'active',
        createdAt: db.serverDate(),
      }
    });

    return { success: true, semesterId: result._id };
  } catch (err) {
    return { success: false, error: err.message };
  }
};
