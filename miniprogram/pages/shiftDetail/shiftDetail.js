const app = getApp();

const { LEAVE_STATUS, SHIFT_TYPE } = require('../../utils/constants');
const { callCloudFunction } = require('../../utils/cloud');
const { formatDate, formatDateTime } = require('../../utils/date');
const { decorateSchedule } = require('../../utils/shift');

function roundHours(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function hasShiftStarted(shift) {
  if (!shift || !shift.date) {
    return true;
  }

  const today = formatDate(new Date());
  if (shift.date < today) {
    return true;
  }

  if (shift.date > today) {
    return false;
  }

  const startMinutes = timeToMinutes(shift.startTime);
  if (startMinutes === null) {
    return true;
  }

  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= startMinutes;
}

Page({
  data: {
    shift: null,
    source: 'my',
    loading: false,
    leaveReasonInput: '',
  },

  buildShiftViewModel(shift, source = 'my') {
    const userInfo = app.globalData.userInfo || {};
    const decorated = decorateSchedule(shift);
    const isMine = decorated.userId === userInfo._id;
    const shiftStarted = hasShiftStarted(decorated);
    const hasValidFlag = typeof shift.isValid === 'boolean';
    const canApplyLeave = isMine
      && decorated.shiftType === SHIFT_TYPE.NORMAL
      && !decorated.checkInTime
      && !decorated.checkOutTime
      && !shiftStarted;
    const canClaimReplacement = source === 'market'
      && !isMine
      && decorated.shiftType === SHIFT_TYPE.LEAVE
      && decorated.leaveStatus === LEAVE_STATUS.PENDING
      && !shiftStarted;

    return {
      ...decorated,
      fixedHoursDisplay: roundHours(shift.fixedHours || shift.shiftHours || 0),
      actualHoursDisplay: roundHours(shift.actualHours || shift.hours || 0),
      overtimeHoursDisplay: roundHours(shift.overtimeHours || 0),
      validText: hasValidFlag ? (shift.isValid ? '有效' : '无效') : '待计算',
      validClass: hasValidFlag ? (shift.isValid ? 'text-success' : 'text-muted') : 'text-muted',
      salaryStatusText: shift.salaryPaid
        ? '工资已发放'
        : (hasValidFlag && shift.isValid ? '工资待发放' : '不计工资'),
      salaryAmountDisplay: roundHours(shift.salaryAmount || 0).toFixed(2),
      salaryRateDisplay: roundHours(shift.salaryRate || 0).toFixed(2),
      salaryPaidAtDisplay: formatDateTime(shift.salaryPaidAt),
      salaryHint: shift.salaryPaid
        ? '该班次工资已经完成发放。'
        : (hasValidFlag && shift.isValid ? '该班次计入工资，等待管理员确认发放。' : '当前班次暂未计入工资结算。'),
      isMine,
      shiftStarted,
      canApplyLeave,
      canClaimReplacement,
      leaveReasonText: shift.leaveReason || '未填写',
      leaveOwnerName: shift.userName || shift.leaveRequesterName || '未记录',
      replacementName: shift.replacementUserName || '暂未认领',
      originalOwnerName: shift.originalUserName || '',
      leaveStatusText: decorated.leaveProgressText || decorated.attendanceText,
      showLeaveSection: decorated.shiftType === SHIFT_TYPE.LEAVE || source === 'market',
      showSwapSection: decorated.shiftType === SHIFT_TYPE.SWAP,
      actionTitle: canApplyLeave ? '申请请假' : (canClaimReplacement ? '认领替班' : ''),
      actionDesc: canApplyLeave
        ? '这个班次还没有开始，填写原因后即可发布请假，其他同学会在“可替班班次”里看到它。'
        : (canClaimReplacement
          ? '确认后这个班次会加入你的“我的班次”，你需要按时签到签退。'
          : ''),
    };
  },

  onLoad(options) {
    if (!options.shiftData) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      wx.navigateBack();
      return;
    }

    try {
      const source = String(options.source || 'my');
      const shift = JSON.parse(decodeURIComponent(options.shiftData));
      this.setData({
        source,
        shift: this.buildShiftViewModel(shift, source),
      });
    } catch (error) {
      console.error('解析班次数据失败:', error);
      wx.showToast({ title: '数据加载失败', icon: 'none' });
    }
  },

  onReasonInput(e) {
    this.setData({
      leaveReasonInput: String(e.detail.value || ''),
    });
  },

  navigateBackSafely() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }

    wx.switchTab({ url: '/pages/myShift/myShift' });
  },

  onApplyLeave() {
    if (this.data.loading || !this.data.shift || !this.data.shift.canApplyLeave) {
      return;
    }

    const reason = String(this.data.leaveReasonInput || '').trim();
    if (!reason) {
      wx.showToast({ title: '请填写请假原因', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认请假',
      content: '提交后该班次会出现在请假班次里，并开放给其他同学认领替班。',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        await this.submitLeave(reason);
      },
    });
  },

  async submitLeave(reason) {
    const userInfo = app.globalData.userInfo;
    const shift = this.data.shift;

    if (!userInfo || !userInfo._id || !shift || !shift._id) {
      wx.showToast({ title: '班次信息异常', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '提交中' });

    try {
      await callCloudFunction('applyLeave', {
        userId: userInfo._id,
        scheduleId: shift._id,
        reason,
      });

      wx.showToast({
        title: '请假已发布',
        icon: 'success',
      });

      setTimeout(() => this.navigateBackSafely(), 600);
    } catch (error) {
      wx.showToast({
        title: error.message || '请假失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },

  onClaimShift() {
    if (this.data.loading || !this.data.shift || !this.data.shift.canClaimReplacement) {
      return;
    }

    wx.showModal({
      title: '确认替班',
      content: '认领后这个班次会加入你的排班列表，你需要按时完成签到和签退。',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        await this.submitClaim();
      },
    });
  },

  async submitClaim() {
    const userInfo = app.globalData.userInfo;
    const shift = this.data.shift;

    if (!userInfo || !userInfo._id || !shift || !shift._id) {
      wx.showToast({ title: '班次信息异常', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '认领中' });

    try {
      await callCloudFunction('claimLeaveShift', {
        userId: userInfo._id,
        userName: userInfo.name || '',
        scheduleId: shift._id,
      });

      wx.showToast({
        title: '替班认领成功',
        icon: 'success',
      });

      setTimeout(() => this.navigateBackSafely(), 600);
    } catch (error) {
      wx.showToast({
        title: error.message || '认领失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },
});
