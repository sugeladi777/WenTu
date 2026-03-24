// 云函数入口文件 - 确认替班
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 班次类型常量
const SHIFT_TYPE_SWAP = 2;  // 替班

exports.main = async (event, context) => {
  const { requestId, action, approverId, approverName } = event; // action: 'accept' | 'reject'

  if (!requestId || !action) {
    return { success: false, error: '参数错误' };
  }

  try {
    const shiftRequestsCollection = db.collection('shiftRequests');
    const schedulesCollection = db.collection('schedules');

    // 获取申请
    const request = await shiftRequestsCollection.doc(requestId).get();
    if (!request.data) {
      return { success: false, error: '申请不存在' };
    }

    if (request.data.status !== 'pending') {
      return { success: false, error: '该申请已处理' };
    }

    const now = new Date();

    // 执行调班或拒绝
    if (action === 'accept') {
      // 交换两个班次的用户
      await schedulesCollection.doc(request.data.fromScheduleId).update({
        data: {
          userId: request.data.toUserId,
          userName: request.data.toUserName,
          originalUserId: request.data.fromUserId,  // 记录原用户
          shiftType: SHIFT_TYPE_SWAP,  // 更新为替班类型
          updatedAt: now,
        }
      });

      await schedulesCollection.doc(request.data.toScheduleId).update({
        data: {
          userId: request.data.fromUserId,
          userName: request.data.fromUserName,
          originalUserId: request.data.toUserId,  // 记录原用户
          shiftType: SHIFT_TYPE_SWAP,  // 更新为替班类型
          updatedAt: now,
        }
      });

      // 更新申请状态
      await shiftRequestsCollection.doc(requestId).update({
        data: {
          status: 'accepted',
          approverId: approverId || '',
          approverName: approverName || '',
          approvedAt: now,
          updatedAt: now,
        }
      });

      return { success: true, message: '调班成功' };
    } else {
      // 拒绝
      await shiftRequestsCollection.doc(requestId).update({
        data: {
          status: 'rejected',
          approverId: approverId || '',
          approverName: approverName || '',
          approvedAt: now,
          updatedAt: now,
        }
      });

      return { success: true, message: '已拒绝调班' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
};
