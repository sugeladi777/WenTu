const app = getApp();

const { USER_ROLE } = require('../../utils/constants');
const { getActiveRole } = require('../../utils/role');
const { callCloudFunction } = require('../../utils/cloud');

function pickActiveSchedule(scheduleId, schedules = [], fallbackSchedule = null) {
  if (scheduleId) {
    const matched = schedules.find((item) => item._id === scheduleId);
    if (matched) {
      return matched;
    }
  }

  if (fallbackSchedule && fallbackSchedule._id) {
    const fallbackMatched = schedules.find((item) => item._id === fallbackSchedule._id);
    if (fallbackMatched) {
      return fallbackMatched;
    }
  }

  return schedules[0] || null;
}

Page({
  data: {
    requester: null,
    leaderSchedules: [],
    activeSchedule: null,
    roster: [],
    loading: false,
  },

  async onLoad() {
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

    const userInfo = await app.refreshUserInfo();
    const activeRole = getActiveRole(userInfo);

    if (!userInfo || ![USER_ROLE.LEADER, USER_ROLE.ADMIN].includes(activeRole)) {
      wx.showToast({ title: '请以班负或管理员身份进入', icon: 'none' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/profile/profile' });
      }, 500);
      return;
    }

    await this.loadRoster('', showLoading);
  },

  async loadRoster(scheduleId = this.data.activeSchedule ? this.data.activeSchedule._id : '', showLoading = false) {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id) {
      return;
    }

    const activeRole = getActiveRole(userInfo);
    const previousLeaderSchedules = this.data.leaderSchedules || [];
    const previousActiveSchedule = this.data.activeSchedule || null;
    const requestId = Date.now();

    this._loadRosterRequestId = requestId;
    this.setData({ loading: true });

    if (showLoading) {
      wx.showLoading({ title: '加载中' });
    }

    try {
      const result = await callCloudFunction('getLeaderShiftRoster', {
        requesterId: userInfo._id,
        scheduleId,
        activeRole,
      });

      if (this._loadRosterRequestId !== requestId) {
        return;
      }

      const nextLeaderSchedules = Array.isArray(result.leaderSchedules) && result.leaderSchedules.length > 0
        ? result.leaderSchedules
        : previousLeaderSchedules;
      const nextActiveSchedule = result.activeSchedule
        || pickActiveSchedule(scheduleId, nextLeaderSchedules, previousActiveSchedule);

      this.setData({
        requester: result.requester || null,
        leaderSchedules: nextLeaderSchedules,
        activeSchedule: nextActiveSchedule,
        roster: result.roster || [],
      });
    } catch (error) {
      if (this._loadRosterRequestId !== requestId) {
        return;
      }

      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none',
      });
    } finally {
      if (showLoading) {
        wx.hideLoading();
      }

      if (this._loadRosterRequestId === requestId) {
        this.setData({ loading: false });
      }
    }
  },

  onSwitchShift(e) {
    const scheduleId = String(e.currentTarget.dataset.id || '').trim();
    if (!scheduleId || (this.data.activeSchedule && scheduleId === this.data.activeSchedule._id)) {
      return;
    }

    this.loadRoster(scheduleId);
  },

  onConfirmPresent(e) {
    this.confirmAttendance(String(e.currentTarget.dataset.id || '').trim(), 'present');
  },

  onConfirmAbsent(e) {
    this.confirmAttendance(String(e.currentTarget.dataset.id || '').trim(), 'absent');
  },

  async confirmAttendance(scheduleId, action) {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id || !scheduleId || this.data.loading) {
      return;
    }

    const actionText = action === 'present' ? '确认签到' : '标记旷岗';

    wx.showModal({
      title: '确认操作',
      content: `确定要${actionText}吗？`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        this.setData({ loading: true });
        wx.showLoading({ title: '提交中' });

        try {
          const result = await callCloudFunction('confirmShiftAttendance', {
            requesterId: userInfo._id,
            requesterName: userInfo.name || '',
            scheduleId,
            action,
          });

          wx.showToast({
            title: result.message || '操作成功',
            icon: 'success',
          });

          await this.loadRoster(this.data.activeSchedule ? this.data.activeSchedule._id : '');
        } catch (error) {
          wx.showToast({
            title: error.message || '操作失败',
            icon: 'none',
          });
        } finally {
          wx.hideLoading();
          this.setData({ loading: false });
        }
      },
    });
  },

  onApproveOvertime(e) {
    this.reviewOvertime(String(e.currentTarget.dataset.id || '').trim(), 'approve');
  },

  onRejectOvertime(e) {
    this.reviewOvertime(String(e.currentTarget.dataset.id || '').trim(), 'reject');
  },

  async reviewOvertime(scheduleId, action) {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id || !scheduleId || this.data.loading) {
      return;
    }

    const actionText = action === 'approve' ? '通过' : '驳回';

    wx.showModal({
      title: '确认审批',
      content: `确定要${actionText}这条加班申请吗？`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        this.setData({ loading: true });
        wx.showLoading({ title: '审批中' });

        try {
          const result = await callCloudFunction('reviewOvertimeRequest', {
            requesterId: userInfo._id,
            requesterName: userInfo.name || '',
            scheduleId,
            action,
          });

          wx.showToast({
            title: result.message || '审批成功',
            icon: 'success',
          });

          await this.loadRoster(this.data.activeSchedule ? this.data.activeSchedule._id : '');
        } catch (error) {
          wx.showToast({
            title: error.message || '审批失败',
            icon: 'none',
          });
        } finally {
          wx.hideLoading();
          this.setData({ loading: false });
        }
      },
    });
  },
});
