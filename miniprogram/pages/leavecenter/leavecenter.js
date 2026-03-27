const app = getApp();

const { callCloudFunction } = require('../../utils/cloud');
const { decorateSchedule } = require('../../utils/shift');

function sortByUpcomingTime(list = []) {
  return [...list].sort((left, right) => {
    if (left.date !== right.date) {
      return String(left.date || '').localeCompare(String(right.date || ''));
    }

    return String(left.startTime || '').localeCompare(String(right.startTime || ''));
  });
}

Page({
  data: {
    semester: null,
    leaveList: [],
    loading: false,
  },

  onLoad() {
    if (!this.ensureSession()) {
      return;
    }

    this._skipNextOnShowRefresh = true;
    this.loadLeaveList();
  },

  onShow() {
    if (!this.ensureSession()) {
      return;
    }

    if (this._skipNextOnShowRefresh) {
      this._skipNextOnShowRefresh = false;
      return;
    }

    this.loadLeaveList();
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

  async loadLeaveList() {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id) {
      return;
    }

    this.setData({ loading: true });

    try {
      let semester = null;

      try {
        const semesterResult = await callCloudFunction('getCurrentSemester');
        semester = semesterResult.semester || null;
      } catch (error) {
        console.warn('获取学期信息失败:', error);
      }

      const result = await callCloudFunction('getAvailableLeaveShifts', {
        userId: userInfo._id,
        semesterId: semester ? semester._id : '',
      });

      const leaveList = sortByUpcomingTime((result.schedules || []).map((item) => {
        const decorated = decorateSchedule(item);
        return {
          ...decorated,
          ownerName: item.userName || item.leaveRequesterName || '同学',
          leaveReasonText: item.leaveReason || '未填写原因',
          timeRange: `${item.startTime || '--'} - ${item.endTime || '--'}`,
        };
      }));

      this.setData({
        semester,
        leaveList,
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

  onShiftTap(e) {
    const id = e.currentTarget.dataset.id;
    const shift = this.data.leaveList.find((item) => item._id === id);

    if (!shift) {
      return;
    }

    const shiftData = encodeURIComponent(JSON.stringify(shift));
    wx.navigateTo({
      url: `/pages/shiftDetail/shiftDetail?shiftData=${shiftData}&source=market`,
    });
  },
});
