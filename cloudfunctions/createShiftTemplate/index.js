// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const semesterId = event.semesterId || '';
    const name = event.name || '';
    const startTime = event.startTime || '';
    const endTime = event.endTime || '';
    const fixedHours = event.fixedHours || 2;
    const maxCapacity = event.maxCapacity || 15;
    
    if (!semesterId || !name || !startTime || !endTime) {
      return { success: false, error: '参数不完整' };
    }

    // 检查学期是否存在
    const semester = await db.collection('semesters').doc(semesterId).get();
    if (!semester.data) {
      return { success: false, error: '学期不存在' };
    }

    const result = await db.collection('shiftTemplates').add({
      data: {
        semesterId: String(semesterId),
        name: String(name),
        startTime: String(startTime),
        endTime: String(endTime),
        fixedHours: Number(fixedHours),
        maxCapacity: Number(maxCapacity),
        currentCount: 0,
        createdAt: db.serverDate(),
      }
    });

    return { success: true, templateId: result._id };
  } catch (err) {
    return { success: false, error: err.message };
  }
};
