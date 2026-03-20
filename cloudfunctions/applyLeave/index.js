// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { userId, date, shiftId, reason } = event;

  if (!userId || !date || !shiftId) {
    return { success: false, error: '请填写完整信息' };
  }

  try {
    const leavesCollection = db.collection('leaves');

    const result = await leavesCollection.add({
      data: {
        userId,
        date,
        shiftId,
        reason: reason || '',
        isManual: false,
        status: 0, // 待审批
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    });

    return { success: true, leaveId: result._id };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
