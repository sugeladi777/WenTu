const app = getApp();

const {
  ATTENDANCE_STATUS,
  LEAVE_STATUS,
  SHIFT_TYPE,
  USER_ROLE,
} = require('../../utils/constants');
const { callCloudFunction } = require('../../utils/cloud');
const { formatDate, formatDateTime } = require('../../utils/date');
const { getActiveRole } = require('../../utils/role');
const { decorateSchedule, getEffectiveAttendanceStatus } = require('../../utils/shift');

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

function stringifyScheduleRecord(schedule = {}) {
  return JSON.stringify(schedule, null, 2);
}

function resolveLeaderName(shift = {}) {
  return String(
    shift.leaderUserName
    || shift.leaveReleasedLeaderUserName
    || '',
  ).trim() || '未安排班负';
}

function isSelfLeader(shift = {}, userId = '') {
  const currentUserId = String(userId || '').trim();
  if (!currentUserId) {
    return false;
  }

  const leaderUserId = String(
    shift.leaderUserId
    || shift.leaveReleasedLeaderUserId
    || '',
  ).trim();

  return Boolean(leaderUserId) && leaderUserId === currentUserId;
}

function canSubmitOvertimeRequest(shift, isMine, effectiveAttendanceStatus) {
  if (!shift || !isMine) {
    return false;
  }

  if (shift.shiftType === SHIFT_TYPE.LEAVE || !shift.checkOutTime || shift.salaryPaid) {
    return false;
  }

  if (
    effectiveAttendanceStatus === ATTENDANCE_STATUS.ABSENT
    || effectiveAttendanceStatus === ATTENDANCE_STATUS.MISSING_CHECKOUT
  ) {
    return false;
  }

  return !['pending', 'approved'].includes(String(shift.overtimeStatus || ''));
}

Page({
  data: {
    shift: null,
    source: 'my',
    loading: false,
    leaveReasonInput: '',
    overtimeHoursInput: '',
    canAdminEdit: false,
    adminRawLoaded: false,
    adminRawLoading: false,
    isEditMode: false,
    editJsonText: '',
  },

  buildShiftViewModel(shift, source = 'my') {
    const userInfo = app.globalData.userInfo || {};
    const activeRole = getActiveRole(userInfo);
    const decorated = decorateSchedule(shift);
    const isMine = decorated.userId === userInfo._id;
    const shiftStarted = hasShiftStarted(decorated);
    const effectiveAttendanceStatus = decorated.effectiveAttendanceStatus != null
      ? decorated.effectiveAttendanceStatus
      : getEffectiveAttendanceStatus(decorated);
    const derivedIsValid = Boolean(
      decorated.checkOutTime
      && (effectiveAttendanceStatus === ATTENDANCE_STATUS.NORMAL || effectiveAttendanceStatus === ATTENDANCE_STATUS.LATE)
      && decorated.shiftType !== SHIFT_TYPE.LEAVE
      && effectiveAttendanceStatus !== ATTENDANCE_STATUS.ABSENT
    );
    const hasValidFlag = typeof shift.isValid === 'boolean' || typeof decorated.isValid === 'boolean';
    const isValid = hasValidFlag ? Boolean(shift.isValid || decorated.isValid) : derivedIsValid;
    const actualHoursValue = shift.actualHours != null
      ? shift.actualHours
      : (shift.hours != null
        ? shift.hours
        : (isValid
          ? roundHours((Number(shift.fixedHours) || 0) + (decorated.overtimeApproved ? (Number(shift.overtimeHours) || 0) : 0))
          : 0));
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
    const leaderSelf = isSelfLeader(shift, userInfo._id);
    const canSubmitOvertime = canSubmitOvertimeRequest(decorated, isMine, effectiveAttendanceStatus);
    const overtimeStatus = String(shift.overtimeStatus || decorated.overtimeStatus || '');
    let overtimeHint = '如有加班，可在这里填写时长并提交；没有加班可直接忽略。';

    if (overtimeStatus === 'pending') {
      overtimeHint = '加班申请待班负审批，通过后计入工时和工资。';
    } else if (overtimeStatus === 'approved' || decorated.overtimeApproved) {
      overtimeHint = '加班申请已通过，相关时长已计入工时和工资。';
    } else if (overtimeStatus === 'rejected') {
      overtimeHint = '加班申请未通过，可重新填写后再次提交。';
    }

    return {
      ...decorated,
      fixedHoursDisplay: roundHours(shift.fixedHours || shift.shiftHours || 0),
      actualHoursDisplay: roundHours(actualHoursValue),
      overtimeHoursDisplay: roundHours(shift.overtimeHours || 0),
      validText: isValid ? '有效' : '无效',
      validClass: isValid ? 'text-success' : 'text-muted',
      salaryStatusText: shift.salaryPaid
        ? '工资已发放'
        : (isValid ? '待发工资' : '不计工资'),
      salaryAmountDisplay: roundHours(shift.salaryAmount || 0).toFixed(2),
      salaryRateDisplay: roundHours(shift.salaryRate || 0).toFixed(2),
      salaryPaidAtDisplay: formatDateTime(shift.salaryPaidAt),
      salaryHint: shift.salaryPaid
        ? '该班次工资已发放。'
        : (isValid ? '该班次将计入工资，等待管理员确认发放。' : '该班次当前不计入工资。'),
      isMine,
      isValid,
      shiftStarted,
      canApplyLeave,
      canClaimReplacement,
      canAdminEdit: source === 'admin' && activeRole === USER_ROLE.ADMIN,
      canSubmitOvertime,
      leaveReasonText: shift.leaveReason || '未填写',
      leaveOwnerName: shift.userName || shift.leaveRequesterName || '未记录',
      replacementName: shift.replacementUserName || '暂无',
      originalOwnerName: shift.originalUserName || '',
      leaderNameText: resolveLeaderName(shift),
      leaderNameClass: leaderSelf ? 'leader-self' : '',
      leaveStatusText: decorated.leaveProgressText || decorated.attendanceText,
      showLeaveSection: decorated.shiftType === SHIFT_TYPE.LEAVE || source === 'market',
      showSwapSection: decorated.shiftType === SHIFT_TYPE.SWAP,
      showBorrowSection: decorated.shiftType === SHIFT_TYPE.BORROW,
      borrowStatusText: decorated.shiftType === SHIFT_TYPE.BORROW ? '已加入我的班次' : '',
      borrowLeaderText: decorated.leaderUserName || '当前未安排班负',
      borrowLeaderClass: leaderSelf ? 'leader-self' : '',
      showLeaderConfirmRow: decorated.shiftType !== SHIFT_TYPE.LEAVE,
      showOvertimeSection: isMine && decorated.shiftType !== SHIFT_TYPE.LEAVE && Boolean(decorated.checkOutTime),
      overtimeHint,
      overtimeButtonText: overtimeStatus === 'rejected' ? '重新提交加班申请' : '提交加班申请',
      actionTitle: canApplyLeave ? '申请请假' : (canClaimReplacement ? '认领替班' : ''),
      actionDesc: canApplyLeave
        ? '班次尚未开始，提交后会进入可替班列表。'
        : (canClaimReplacement ? '认领后，如你原本不在这个班次中，系统会加入你的排班；若你是在原班次中接任班负，则不会重复新增班次。' : ''),
    };
  },

  onLoad(options) {
    if (!options.shiftData) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      this.navigateBackSafely();
      return;
    }

    try {
      const source = String(options.source || 'my');
      const shift = JSON.parse(decodeURIComponent(options.shiftData));
      const viewModel = this.buildShiftViewModel(shift, source);
      const canAdminEdit = Boolean(viewModel.canAdminEdit);

      this.rawShiftRecord = canAdminEdit ? null : shift;
      this.setData({
        source,
        shift: viewModel,
        canAdminEdit,
        adminRawLoaded: !canAdminEdit,
        adminRawLoading: false,
        isEditMode: false,
        editJsonText: canAdminEdit ? '' : stringifyScheduleRecord(shift),
        overtimeHoursInput: '',
      });

      if (canAdminEdit && shift && shift._id) {
        this.loadAdminRawSchedule(shift._id);
      }
    } catch (error) {
      console.error('解析班次数据失败:', error);
      wx.showToast({ title: '数据加载失败', icon: 'none' });
      this.navigateBackSafely();
    }
  },

  async loadAdminRawSchedule(scheduleId) {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id || !scheduleId) {
      return;
    }

    this.setData({ adminRawLoading: true });

    try {
      const result = await callCloudFunction('getScheduleByAdmin', {
        requesterId: userInfo._id,
        scheduleId,
      });
      const schedule = result.schedule || null;

      if (!schedule || !schedule._id) {
        throw new Error('班次记录不存在');
      }

      this.rawShiftRecord = schedule;
      this.setData({
        shift: this.buildShiftViewModel(schedule, this.data.source),
        adminRawLoaded: true,
        editJsonText: stringifyScheduleRecord(schedule),
      });
    } catch (error) {
      wx.showToast({
        title: error.message || '获取原始班次失败',
        icon: 'none',
      });
    } finally {
      this.setData({ adminRawLoading: false });
    }
  },

  onReasonInput(e) {
    this.setData({
      leaveReasonInput: String(e.detail.value || ''),
    });
  },

  onOvertimeInput(e) {
    this.setData({
      overtimeHoursInput: String(e.detail.value || ''),
    });
  },

  onToggleEditMode() {
    if (!this.data.canAdminEdit || !this.data.shift || this.data.loading || this.data.adminRawLoading) {
      return;
    }

    if (!this.data.adminRawLoaded || !this.rawShiftRecord) {
      wx.showToast({
        title: '原始记录仍在加载，请稍后',
        icon: 'none',
      });
      return;
    }

    const nextEditMode = !this.data.isEditMode;
    this.setData({
      isEditMode: nextEditMode,
      editJsonText: nextEditMode ? stringifyScheduleRecord(this.rawShiftRecord) : this.data.editJsonText,
    });
  },

  onAdminJsonInput(e) {
    this.setData({
      editJsonText: String(e.detail.value || ''),
    });
  },

  onReloadAdminRaw() {
    const shift = this.data.shift;
    if (!this.data.canAdminEdit || this.data.loading || this.data.adminRawLoading || !shift || !shift._id) {
      return;
    }

    this.loadAdminRawSchedule(shift._id);
  },

  async onSaveAdminEdit() {
    const userInfo = app.globalData.userInfo;
    const shift = this.data.shift;
    const editJsonText = String(this.data.editJsonText || '').trim();

    if (
      !this.data.canAdminEdit
      || !this.data.adminRawLoaded
      || this.data.loading
      || !shift
      || !shift._id
      || !userInfo
      || !userInfo._id
    ) {
      return;
    }

    if (!editJsonText) {
      wx.showToast({ title: '请先填写完整记录 JSON', icon: 'none' });
      return;
    }

    let scheduleData = null;
    try {
      scheduleData = JSON.parse(editJsonText);
    } catch (error) {
      wx.showToast({ title: 'JSON 格式不正确', icon: 'none' });
      return;
    }

    if (!scheduleData || typeof scheduleData !== 'object' || Array.isArray(scheduleData)) {
      wx.showToast({ title: '班次记录必须是对象', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '保存中' });

    try {
      const result = await callCloudFunction('updateScheduleByAdmin', {
        requesterId: userInfo._id,
        scheduleId: shift._id,
        scheduleData,
      });
      const updatedShift = result.schedule || null;

      if (!updatedShift || !updatedShift._id) {
        throw new Error('班次返回数据异常');
      }

      this.rawShiftRecord = updatedShift;
      this.setData({
        shift: this.buildShiftViewModel(updatedShift, this.data.source),
        isEditMode: false,
        editJsonText: stringifyScheduleRecord(updatedShift),
      });

      wx.showToast({
        title: result.message || '保存成功',
        icon: 'success',
      });
    } catch (error) {
      wx.showToast({
        title: error.message || '保存失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },

  navigateBackSafely() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({
        fail: () => {
          wx.switchTab({ url: '/pages/myShift/myShift' });
        },
      });
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
      content: '提交后，该班次会出现在可替班班次中。',
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

  onSubmitOvertimeRequest() {
    const shift = this.data.shift;
    const inputValue = String(this.data.overtimeHoursInput || '').trim();

    if (this.data.loading || !shift || !shift.canSubmitOvertime) {
      return;
    }

    if (!inputValue) {
      wx.showToast({ title: '请填写加班时长', icon: 'none' });
      return;
    }

    const overtimeHours = roundHours(inputValue);
    if (!Number.isFinite(overtimeHours) || overtimeHours <= 0) {
      wx.showToast({ title: '加班时长必须大于 0', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '提交加班申请',
      content: `确认提交 ${overtimeHours} 小时的加班申请吗？`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        await this.submitOvertimeRequest(overtimeHours);
      },
    });
  },

  async submitOvertimeRequest(overtimeHours) {
    const userInfo = app.globalData.userInfo;
    const shift = this.data.shift;

    if (!userInfo || !userInfo._id || !shift || !shift._id) {
      wx.showToast({ title: '班次信息异常', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '提交中' });

    try {
      const result = await callCloudFunction('submitOvertimeRequest', {
        userId: userInfo._id,
        scheduleId: shift._id,
        overtimeHours,
      });
      const updatedShift = result.schedule || null;

      if (updatedShift && updatedShift._id) {
        this.setData({
          shift: this.buildShiftViewModel(updatedShift, this.data.source),
          overtimeHoursInput: '',
        });
      }

      wx.showToast({
        title: result.message || '加班申请已提交',
        icon: 'success',
      });
    } catch (error) {
      wx.showToast({
        title: error.message || '提交失败',
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
      content: '认领后，如你原本不在这个班次中，系统会加入你的排班；若你是在原班次中接任班负，则不会重复新增班次。',
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
        title: '认领成功',
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
