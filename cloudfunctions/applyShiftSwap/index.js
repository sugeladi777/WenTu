// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { semesterId, fromScheduleId, toScheduleId, applicantId, applicantName } = event;

  if (!semesterId || !fromScheduleId || !toScheduleId || !applicantId) {
    return { success: false, error: '参数错误' };
  }

  try {
    const shiftRequestsCollection = db.collection('shiftRequests');
    const schedulesCollection = db.collection('schedules');

    // 获取申请人的班次
    const fromSchedule = await schedulesCollection.doc(fromScheduleId).get();
    if (!fromSchedule.data) {
      return { success: false, error: '找不到您的班次' };
    }

    // 获取目标人的班次
    const toSchedule = await schedulesCollection.doc(toScheduleId).get();
    if (!toSchedule.data) {
      return { success: false, error: '找不到对方的班次' };
    }

    // 不能和自己换
    if (fromScheduleId === toScheduleId) {
      return { success: false, error: '不能和自己换班' };
    }

    // 检查是否已有待处理的调班申请
    const existing = await shiftRequestsCollection
      .where({
        fromScheduleId,
        status: 'pending',
      })
      .get();

    if (existing.data.length > 0) {
      return { success: false, error: '您已提交过调班申请' };
    }

    // 创建调班申请
    const result = await shiftRequestsCollection.add({
      data: {
        semesterId,
        fromScheduleId,
        fromUserId: fromSchedule.data.userId,
        fromUserName: fromSchedule.data.userName,
        fromDate: fromSchedule.data.date,
        fromShiftName: fromSchedule.data.shiftName,
        toScheduleId,
        toUserId: toSchedule.data.userId,
        toUserName: toSchedule.data.userName,
        toDate: toSchedule.data.date,
        toShiftName: toSchedule.data.shiftName,
        applicantId,
        applicantName: applicantName || '',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    });

    return { success: true, requestId: result._id };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
