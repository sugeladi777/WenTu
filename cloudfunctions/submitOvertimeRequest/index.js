const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_LEAVE = 1;
const ATTENDANCE_MISSING_CHECKOUT = 2;
const ATTENDANCE_ABSENT = 3;

function roundHours(value) {
  const hours = Number(value);
  if (Number.isNaN(hours)) {
    return NaN;
  }

  return Math.round(hours * 100) / 100;
}

exports.main = async (event = {}) => {
  const userId = String(event.userId || '').trim();
  const scheduleId = String(event.scheduleId || '').trim();
  const overtimeHours = roundHours(event.overtimeHours);

  if (!userId || !scheduleId) {
    return { success: false, error: '参数错误' };
  }

  if (!Number.isFinite(overtimeHours) || overtimeHours <= 0) {
    return { success: false, error: '加班时长必须大于 0' };
  }

  try {
    const scheduleResult = await db.collection('schedules').doc(scheduleId).get();
    const schedule = scheduleResult.data || null;

    if (!schedule || schedule.userId !== userId) {
      return { success: false, error: '只能申请自己的班次加班' };
    }

    if (schedule.shiftType === SHIFT_TYPE_LEAVE) {
      return { success: false, error: '请假班次不能申请加班' };
    }

    if (!schedule.checkOutTime) {
      return { success: false, error: '请先完成签退，再提交加班申请' };
    }

    if (schedule.attendanceStatus === ATTENDANCE_ABSENT || schedule.attendanceStatus === ATTENDANCE_MISSING_CHECKOUT) {
      return { success: false, error: '当前班次考勤状态不支持申请加班' };
    }

    if (schedule.salaryPaid) {
      return { success: false, error: '该班次工资已发放，不能再提交加班申请' };
    }

    if (schedule.overtimeStatus === 'approved') {
      return { success: false, error: '该班次加班已经审批通过' };
    }

    await db.collection('schedules').doc(scheduleId).update({
      data: {
        overtimeHours,
        overtimeApproved: false,
        overtimeStatus: 'pending',
        overtimeRequestedAt: db.serverDate(),
        overtimeReviewedAt: null,
        overtimeReviewedBy: null,
        overtimeReviewedByName: '',
        updatedAt: db.serverDate(),
      },
    });

    const updatedResult = await db.collection('schedules').doc(scheduleId).get();

    return {
      success: true,
      message: '加班申请已提交，等待班负审批',
      overtimeHours,
      schedule: updatedResult.data || null,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
