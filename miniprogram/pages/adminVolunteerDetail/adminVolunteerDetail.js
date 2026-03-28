const app = getApp();

const { SHIFT_TYPE, USER_ROLE } = require('../../utils/constants');
const { callCloudFunction } = require('../../utils/cloud');
const { formatDateTime } = require('../../utils/date');
const { formatGrantedRoles, getActiveRole, hasRole } = require('../../utils/role');
const { decorateSchedule } = require('../../utils/shift');

function roundNumber(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatHours(value) {
  return String(roundNumber(value));
}

function formatMoney(value) {
  return roundNumber(value).toFixed(2);
}

function getRoleClass(userInfo) {
  if (hasRole(userInfo, USER_ROLE.ADMIN)) {
    return 'admin';
  }

  if (hasRole(userInfo, USER_ROLE.LEADER)) {
    return 'leader';
  }

  return 'member';
}

function getRoleBadgeText(userInfo) {
  if (hasRole(userInfo, USER_ROLE.ADMIN)) {
    return '管理员';
  }

  if (hasRole(userInfo, USER_ROLE.LEADER)) {
    return '班负';
  }

  return '志愿者';
}

Page({
  data: {
    loading: false,
    leaderActionScheduleId: '',
    semester: null,
    userInfo: null,
    overviewCards: [],
    attendanceCards: [],
    salaryCards: [],
    shiftList: [],
  },

  async onLoad(options) {
    this.targetUserId = String(options.userId || '').trim();
    if (!this.targetUserId) {
      wx.showToast({ title: '用户参数缺失', icon: 'none' });
      setTimeout(() => {
        wx.navigateBack({
          delta: 1,
          fail: () => {
            wx.reLaunch({ url: '/pages/adminDashboard/adminDashboard' });
          },
        });
      }, 400);
      return;
    }

    this._skipNextOnShowRefresh = true;
    await this.bootstrapPage(true);
  },

  async onShow() {
    if (this._skipNextOnShowRefresh) {
      this._skipNextOnShowRefresh = false;
      return;
    }

    await this.bootstrapPage(false);
  },

  async bootstrapPage(showLoading = false) {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }

    const currentUser = await app.refreshUserInfo();
    if (!currentUser || getActiveRole(currentUser) !== USER_ROLE.ADMIN) {
      wx.showToast({ title: '请以管理员身份进入', icon: 'none' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/profile/profile' });
      }, 500);
      return;
    }

    await this.loadDetail(showLoading);
  },

  buildUserInfo(userInfo, semester) {
    return {
      ...userInfo,
      displayName: userInfo.nickname || userInfo.name || '未命名用户',
      nicknameText: userInfo.nickname || '未填写',
      createdAtText: formatDateTime(userInfo.createdAt),
      updatedAtText: formatDateTime(userInfo.updatedAt),
      rewardScoreText: String(Number(userInfo.rewardScore || 0)),
      roleClass: getRoleClass(userInfo),
      roleBadgeText: getRoleBadgeText(userInfo),
      grantedRolesText: formatGrantedRoles(userInfo),
      semesterName: semester ? semester.name : '暂无学期',
      semesterRange: semester ? `${semester.startDate} 至 ${semester.endDate}` : '暂无学期信息',
    };
  },

  buildOverviewCards(summary = {}) {
    return [
      { label: '班次总数', value: Number(summary.totalShifts || 0) },
      { label: '已完成班次', value: Number(summary.completedShifts || 0) },
      { label: '有效工时', value: formatHours(summary.validHours || 0) },
      { label: '请假班次', value: Number(summary.leaveShifts || 0) },
    ];
  },

  buildAttendanceCards(summary = {}) {
    return [
      { label: '已签到', value: Number(summary.checkedInCount || 0) },
      { label: '已签退', value: Number(summary.checkedOutCount || 0) },
      { label: '迟到', value: Number(summary.lateShifts || 0) },
      { label: '旷岗', value: Number(summary.absentShifts || 0) },
      { label: '未签退', value: Number(summary.missingCheckoutShifts || 0) },
    ];
  },

  buildSalaryCards(summary = {}) {
    return [
      { label: '已发班次数', value: Number(summary.paidShiftCount || 0) },
      { label: '已发工时', value: formatHours(summary.paidHours || 0) },
      { label: '已发工资', value: `¥${formatMoney(summary.paidAmount || 0)}` },
      { label: '待发班次数', value: Number(summary.unpaidShiftCount || 0) },
      { label: '待发工时', value: formatHours(summary.unpaidHours || 0) },
    ];
  },

  buildLeaderMeta(item) {
    const targetUserId = this.targetUserId;
    const leaderUserId = String(item.leaderUserId || '').trim();
    const leaderUserName = String(item.leaderUserName || '').trim();
    const isTargetLeader = leaderUserId && leaderUserId === targetUserId;

    if (item.shiftType === SHIFT_TYPE.LEAVE) {
      return {
        canManageLeader: false,
        leaderAction: '',
        leaderActionText: '请假班次不可任命',
        leaderActionClass: 'disabled',
        leaderActionHint: '该班次已请假，不能把当前志愿者任命为班负',
        leaderDisplayText: leaderUserName ? `当前班负：${leaderUserName}` : '当前班负：未任命',
        leaderDisplayClass: leaderUserName ? 'assigned' : 'empty',
      };
    }

    if (isTargetLeader) {
      return {
        canManageLeader: true,
        leaderAction: 'clear',
        leaderActionText: '撤销该班次班负',
        leaderActionClass: 'outline',
        leaderActionHint: '当前志愿者已被任命为这个班次的班负',
        leaderDisplayText: '当前班负：本人',
        leaderDisplayClass: 'self',
      };
    }

    if (!leaderUserId) {
      return {
        canManageLeader: true,
        leaderAction: 'assign',
        leaderActionText: '任命为该班次班负',
        leaderActionClass: '',
        leaderActionHint: '当前班次还没有班负',
        leaderDisplayText: '当前班负：未任命',
        leaderDisplayClass: 'empty',
      };
    }

    return {
      canManageLeader: true,
      leaderAction: 'assign',
      leaderActionText: '改派为该班次班负',
      leaderActionClass: '',
      leaderActionHint: `当前班负：${leaderUserName}`,
      leaderDisplayText: `当前班负：${leaderUserName}`,
      leaderDisplayClass: 'assigned',
    };
  },

  buildShiftList(schedules = []) {
    return schedules.map((item) => {
      const decorated = decorateSchedule(item);
      const isPaid = Boolean(item.salaryPaid);
      const isPayable = Boolean(item.isValid);
      const leaderMeta = this.buildLeaderMeta(item);

      return {
        ...decorated,
        ...leaderMeta,
        actualHoursText: formatHours(item.actualHours || item.hours || 0),
        fixedHoursText: formatHours(item.fixedHours || 0),
        timeRange: `${item.startTime || '--'} - ${item.endTime || '--'}`,
        checkInText: item.checkInTime ? decorated.checkInTimeLabel : '未签到',
        checkOutText: item.checkOutTime ? decorated.checkOutTimeLabel : '未签退',
        salaryText: isPaid
          ? `已发 ¥${formatMoney(item.salaryAmount || 0)}`
          : (isPayable ? '待发工资' : '不计工资'),
        salaryClass: isPaid ? 'paid' : (isPayable ? 'pending' : 'muted'),
        salarySubtext: isPaid
          ? `发放时间 ${decorated.salaryPaidAtLabel}`
          : (isPayable ? '当前班次已计入待发工资' : '当前班次不计入工资'),
      };
    });
  },

  async loadDetail(showLoading = false) {
    const requester = app.globalData.userInfo;
    if (!requester || !requester._id) {
      return;
    }

    this.setData({ loading: true });
    if (showLoading) {
      wx.showLoading({ title: '加载中' });
    }

    try {
      const result = await callCloudFunction('getAdminUserDetail', {
        requesterId: requester._id,
        targetUserId: this.targetUserId,
      });

      const semester = result.semester || null;
      const userInfo = this.buildUserInfo(result.userInfo || {}, semester);
      const summary = result.summary || {};

      this.setData({
        semester,
        userInfo,
        overviewCards: this.buildOverviewCards(summary),
        attendanceCards: this.buildAttendanceCards(summary),
        salaryCards: this.buildSalaryCards(summary),
        shiftList: this.buildShiftList(result.schedules || []),
      });
    } catch (error) {
      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none',
      });
    } finally {
      if (showLoading) {
        wx.hideLoading();
      }
      this.setData({ loading: false });
    }
  },

  onOpenShift(e) {
    const shiftId = String(e.currentTarget.dataset.id || '').trim();
    const shift = this.data.shiftList.find((item) => item._id === shiftId);
    if (!shift) {
      return;
    }

    const shiftData = encodeURIComponent(JSON.stringify(shift));
    wx.navigateTo({
      url: `/pages/shiftDetail/shiftDetail?shiftData=${shiftData}&source=admin`,
    });
  },

  onToggleShiftLeader(e) {
    const scheduleId = String(e.currentTarget.dataset.id || '').trim();
    const action = String(e.currentTarget.dataset.action || '').trim();
    const shift = this.data.shiftList.find((item) => item._id === scheduleId);
    const { userInfo, loading, leaderActionScheduleId } = this.data;

    if (!shift || !userInfo || loading || leaderActionScheduleId) {
      return;
    }

    let content = '';
    if (action === 'clear') {
      content = `确定撤销 ${userInfo.displayName} 的该班次班负身份吗？`;
    } else if (shift.leaderUserName && String(shift.leaderUserId || '').trim() !== this.targetUserId) {
      content = `确定将该班次班负从 ${shift.leaderUserName} 改派为 ${userInfo.displayName} 吗？`;
    } else {
      content = `确定任命 ${userInfo.displayName} 为该班次班负吗？`;
    }

    wx.showModal({
      title: '确认操作',
      content,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        await this.submitShiftLeaderChange(scheduleId, action);
      },
    });
  },

  async submitShiftLeaderChange(scheduleId, action) {
    const requester = app.globalData.userInfo;
    if (!requester || !requester._id) {
      return;
    }

    this.setData({
      loading: true,
      leaderActionScheduleId: scheduleId,
    });
    wx.showLoading({ title: '提交中' });

    try {
      const result = await callCloudFunction('setShiftLeader', {
        requesterId: requester._id,
        scheduleId,
        action,
      });

      wx.showToast({
        title: result.message || '操作成功',
        icon: 'success',
      });

      await this.loadDetail(false);
    } catch (error) {
      wx.showToast({
        title: error.message || '操作失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({
        loading: false,
        leaderActionScheduleId: '',
      });
    }
  },
});
