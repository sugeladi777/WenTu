// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    // 获取当前正在进行的学期
    const today = new Date().toISOString().split('T')[0];
    
    const semesters = await db.collection('semesters')
      .where({
        status: 'active',
        startDate: db.command.lte(today),
        endDate: db.command.gte(today),
      })
      .get();

    if (semesters.data && semesters.data.length > 0) {
      return { success: true, semester: semesters.data[0] };
    }

    // 如果没有当前学期，返回最近的学期
    const latest = await db.collection('semesters')
      .where({ status: 'active' })
      .orderBy('startDate', 'desc')
      .limit(1)
      .get();
    
    if (latest.data && latest.data.length > 0) {
      return { success: true, semester: latest.data[0] };
    }

    return { success: false, error: '暂无学期信息' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
