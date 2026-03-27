const app = getApp();

const { USER_ROLE } = require('../../utils/constants');
const { getActiveRole } = require('../../utils/role');
const { callCloudFunction } = require('../../utils/cloud');

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

    this.setData({ loading: true });
    if (showLoading) {
      wx.showLoading({ title: '加载中' });
    }

    try {
      const result = await callCloudFunction('getLeaderShiftRoster', {
        requesterId: userInfo._id,
        scheduleId,
      });

      this.setData({
        requester: result.requester || null,
        leaderSchedules: result.leaderSchedules || [],
        activeSchedule: result.activeSchedule || null,
        roster: result.roster || [],
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

  onSwitchShift(e) {
    const scheduleId = String(e.currentTarget.dataset.id || '');
    if (!scheduleId || (this.data.activeSchedule && scheduleId === this.data.activeSchedule._id)) {
      return;
    }

    this.loadRoster(scheduleId);
  },

  onConfirmPresent(e) {
    this.confirmAttendance(e.currentTarget.dataset.id, 'present');
  },

  onConfirmAbsent(e) {
    this.confirmAttendance(e.currentTarget.dataset.id, 'absent');
  },

  async confirmAttendance(scheduleId, action) {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id || !scheduleId || this.data.loading) {
      return;
    }

    const actionText = action === 'present' ? '确认为到岗' : '标记为旷岗';

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
});
