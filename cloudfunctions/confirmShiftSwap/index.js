const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_SWAP = 2;

exports.main = async (event) => {
  const requestId = String(event.requestId || '').trim();
  const action = String(event.action || '').trim();
  const approverId = String(event.approverId || '').trim();
  const approverName = String(event.approverName || '').trim();

  if (!requestId || !action) {
    return { success: false, error: '参数错误' };
  }

  try {
    const shiftRequestsCollection = db.collection('shiftRequests');
    const schedulesCollection = db.collection('schedules');
    const requestResult = await shiftRequestsCollection.doc(requestId).get();
    const request = requestResult.data;

    if (!request) {
      return { success: false, error: '申请不存在' };
    }

    if (request.status !== 'pending') {
      return { success: false, error: '该申请已处理' };
    }

    if (action === 'accept') {
      const fromScheduleResult = await schedulesCollection.doc(request.fromScheduleId).get();
      const toScheduleResult = await schedulesCollection.doc(request.toScheduleId).get();
      const fromSchedule = fromScheduleResult.data;
      const toSchedule = toScheduleResult.data;

      if (!fromSchedule || !toSchedule) {
        return { success: false, error: '班次不存在' };
      }

      if (fromSchedule.checkInTime || fromSchedule.checkOutTime || toSchedule.checkInTime || toSchedule.checkOutTime) {
        return { success: false, error: '班次已产生考勤记录，不能调班' };
      }

      await schedulesCollection.doc(request.fromScheduleId).update({
        data: {
          userId: request.toUserId,
          userName: request.toUserName,
          originalUserId: request.fromUserId,
          shiftType: SHIFT_TYPE_SWAP,
          updatedAt: db.serverDate(),
        },
      });

      await schedulesCollection.doc(request.toScheduleId).update({
        data: {
          userId: request.fromUserId,
          userName: request.fromUserName,
          originalUserId: request.toUserId,
          shiftType: SHIFT_TYPE_SWAP,
          updatedAt: db.serverDate(),
        },
      });

      await shiftRequestsCollection.doc(requestId).update({
        data: {
          status: 'accepted',
          approverId,
          approverName,
          approvedAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });

      return { success: true, message: '调班成功' };
    }

    await shiftRequestsCollection.doc(requestId).update({
      data: {
        status: 'rejected',
        approverId,
        approverName,
        approvedAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });

    return { success: true, message: '已拒绝调班' };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
