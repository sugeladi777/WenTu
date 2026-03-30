const app = getApp();

const { callCloudFunction } = require('../../utils/cloud');

Page({
  data: {
    semester: null,
    slotList: [],
    loading: false,
    submittingScheduleId: '',
  },

  onLoad() {
    if (!this.ensureSession()) {
      return;
    }

    this._skipNextOnShowRefresh = true;
    this.loadPageData();
  },

  onShow() {
    if (!this.ensureSession()) {
      return;
    }

    if (this._skipNextOnShowRefresh) {
      this._skipNextOnShowRefresh = false;
      return;
    }

    this.loadPageData();
  },

  ensureSession() {
    const userInfo = app.globalData.userInfo;
    if (userInfo && userInfo._id) {
      return true;
    }

    wx.showToast({
      title: '登录状态已失效',
      icon: 'none',
    });

    setTimeout(() => {
      app.goToLogin();
    }, 120);

    return false;
  },

  async loadPageData() {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id) {
      return;
    }

    this.setData({ loading: true });

    try {
      const result = await callCloudFunction('getLeaderApplicationOptions', {
        userId: userInfo._id,
      });

      const slotList = (result.slots || []).map((item) => {
        return {
          ...item,
          titleLine: `${item.weekdayText || ''} · ${item.shiftName || '未命名班次'}`,
          timeLine: `${item.startTime || '--'} - ${item.endTime || '--'} · ${Number(item.fixedHours || 0)} 小时`,
          currentLeaderLine: item.currentLeaderUserName ? `当前班负：${item.currentLeaderUserName}` : '当前班负：未任命',
          statusClass: item.statusTone || 'muted',
          actionClass: item.canApply ? 'action-btn' : 'action-btn disabled',
        };
      });

      this.setData({
        semester: result.semester || null,
        slotList,
      });
    } catch (error) {
      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none',
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  onApplyTap(e) {
    const scheduleId = String(e.currentTarget.dataset.id || '').trim();
    const slot = this.data.slotList.find((item) => item.scheduleId === scheduleId);

    if (!slot || !slot.canApply || this.data.loading || this.data.submittingScheduleId) {
      return;
    }

    wx.showModal({
      title: '提交班负申请',
      content: `确定申请负责 ${slot.weekdayText} 的“${slot.shiftName}”吗？`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        await this.submitApplication(scheduleId);
      },
    });
  },

  async submitApplication(scheduleId) {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id || !scheduleId) {
      return;
    }

    this.setData({
      loading: true,
      submittingScheduleId: scheduleId,
    });
    wx.showLoading({ title: '提交中' });

    try {
      const result = await callCloudFunction('submitLeaderApplication', {
        userId: userInfo._id,
        scheduleId,
      });

      wx.showToast({
        title: result.message || '申请已提交',
        icon: 'success',
      });

      await this.loadPageData();
    } catch (error) {
      wx.showToast({
        title: error.message || '提交失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({
        loading: false,
        submittingScheduleId: '',
      });
    }
  },
});
