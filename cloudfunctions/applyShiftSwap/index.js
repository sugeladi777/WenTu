const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function toChinaDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const offsetMinutes = 8 * 60 + date.getTimezoneOffset();
  return new Date(date.getTime() + offsetMinutes * 60 * 1000);
}

function formatChinaDate(input = new Date()) {
  const chinaDate = toChinaDate(input);
  return `${chinaDate.getUTCFullYear()}-${padNumber(chinaDate.getUTCMonth() + 1)}-${padNumber(chinaDate.getUTCDate())}`;
}

exports.main = async (event) => {
  const semesterId = String(event.semesterId || '').trim();
  const fromScheduleId = String(event.fromScheduleId || '').trim();
  const toScheduleId = String(event.toScheduleId || '').trim();
  const applicantId = String(event.applicantId || '').trim();
  const applicantName = String(event.applicantName || '').trim();

  if (!semesterId || !fromScheduleId || !toScheduleId || !applicantId) {
    return { success: false, error: '参数错误' };
  }

  if (fromScheduleId === toScheduleId) {
    return { success: false, error: '不能和自己换班' };
  }

  try {
    const shiftRequestsCollection = db.collection('shiftRequests');
    const schedulesCollection = db.collection('schedules');

    const fromScheduleResult = await schedulesCollection.doc(fromScheduleId).get();
    const toScheduleResult = await schedulesCollection.doc(toScheduleId).get();
    const fromSchedule = fromScheduleResult.data;
    const toSchedule = toScheduleResult.data;

    if (!fromSchedule || !toSchedule) {
      return { success: false, error: '班次不存在' };
    }

    if (fromSchedule.userId !== applicantId) {
      return { success: false, error: '只能发起自己的班次调班' };
    }

    if (toSchedule.userId === applicantId) {
      return { success: false, error: '不能和自己换班' };
    }

    if (fromSchedule.semesterId !== semesterId || toSchedule.semesterId !== semesterId) {
      return { success: false, error: '班次与学期不匹配' };
    }

    if (fromSchedule.date < formatChinaDate() || toSchedule.date < formatChinaDate()) {
      return { success: false, error: '历史班次不能调班' };
    }

    if (fromSchedule.checkInTime || fromSchedule.checkOutTime || toSchedule.checkInTime || toSchedule.checkOutTime) {
      return { success: false, error: '已产生考勤记录的班次不能调班' };
    }

    const existing = await shiftRequestsCollection
      .where({
        fromScheduleId,
        status: 'pending',
      })
      .limit(1)
      .get();

    if (existing.data && existing.data.length > 0) {
      return { success: false, error: '您已提交过调班申请' };
    }

    const result = await shiftRequestsCollection.add({
      data: {
        semesterId,
        fromScheduleId,
        fromUserId: fromSchedule.userId,
        fromUserName: fromSchedule.userName,
        fromDate: fromSchedule.date,
        fromShiftName: fromSchedule.shiftName,
        toScheduleId,
        toUserId: toSchedule.userId,
        toUserName: toSchedule.userName,
        toDate: toSchedule.date,
        toShiftName: toSchedule.shiftName,
        applicantId,
        applicantName,
        status: 'pending',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });

    return { success: true, requestId: result._id };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
