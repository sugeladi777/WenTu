const app = getApp();

const { formatDate } = require('../../utils/date');
const { callCloudFunction } = require('../../utils/cloud');

function clampDate(dateString, minDate, maxDate) {
  let nextDate = String(dateString || '').trim();

  if (!nextDate) {
    nextDate = minDate;
  }

  if (minDate && nextDate < minDate) {
    nextDate = minDate;
  }

  if (maxDate && nextDate > maxDate) {
    nextDate = maxDate;
  }

  return nextDate;
}

function buildDateRange(semester) {
  const today = formatDate(new Date());
  const semesterStart = String((semester && semester.startDate) || '').trim();
  const semesterEnd = String((semester && semester.endDate) || '').trim();
  const minDate = semesterStart && semesterStart > today ? semesterStart : today;

  return {
    minDate,
    maxDate: semesterEnd,
  };
}

Page({
  data: {
    semester: null,
    selectedDate: '',
    minDate: '',
    maxDate: '',
    optionList: [],
    loading: false,
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
      const semesterResult = await callCloudFunction('getCurrentSemester');
      const semester = semesterResult.semester || null;

      if (!semester || !semester._id) {
        this.setData({
          semester: null,
          selectedDate: '',
          minDate: '',
          maxDate: '',
          optionList: [],
        });
        return;
      }

      const { minDate, maxDate } = buildDateRange(semester);
      const selectedDate = clampDate(this.data.selectedDate || minDate, minDate, maxDate);

      this.setData({
        semester,
        selectedDate,
        minDate,
        maxDate,
      });

      await this.loadBorrowOptions(selectedDate, semester._id);
    } catch (error) {
      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none',
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadBorrowOptions(selectedDate = this.data.selectedDate, semesterId = this.data.semester ? this.data.semester._id : '') {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id || !selectedDate || !semesterId) {
      return;
    }

    this.setData({ loading: true });

    try {
      const result = await callCloudFunction('getBorrowShiftOptions', {
        userId: userInfo._id,
        semesterId,
        date: selectedDate,
      });

      const optionList = (result.templates || []).map((item) => {
        return {
          ...item,
          timeRange: `${item.startTime || '--'} - ${item.endTime || '--'}`,
          leaderText: item.leaderUserName || '当前未安排班负',
          assignedText: `${Number(item.assignedCount || 0)} 人`,
          statusClass: item.canJoin ? 'status-available' : 'status-disabled',
          joinButtonClass: item.canJoin ? 'action-btn join' : 'action-btn disabled',
          joinButtonText: item.canJoin ? '添加蹭班' : item.statusText,
        };
      });

      this.setData({
        selectedDate,
        optionList,
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

  onDateChange(e) {
    const selectedDate = String(e.detail.value || '').trim();
    if (!selectedDate || selectedDate === this.data.selectedDate) {
      return;
    }

    this.loadBorrowOptions(selectedDate);
  },

  onJoinTap(e) {
    const shiftId = String(e.currentTarget.dataset.shiftid || '').trim();
    const option = this.data.optionList.find((item) => item.shiftId === shiftId);

    if (!option || !option.canJoin || this.data.loading) {
      return;
    }

    wx.showModal({
      title: '确认添加蹭班',
      content: `确定将 ${this.data.selectedDate} 的“${option.shiftName}”加入我的班次吗？`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        await this.submitBorrowShift(option.shiftId);
      },
    });
  },

  async submitBorrowShift(shiftId) {
    const userInfo = app.globalData.userInfo;
    const semester = this.data.semester;

    if (!userInfo || !userInfo._id || !shiftId || !semester || !semester._id) {
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '添加中' });

    try {
      await callCloudFunction('createBorrowShift', {
        userId: userInfo._id,
        semesterId: semester._id,
        date: this.data.selectedDate,
        shiftId,
      });

      wx.showToast({
        title: '已加入我的班次',
        icon: 'success',
      });

      await this.loadBorrowOptions(this.data.selectedDate, semester._id);
    } catch (error) {
      wx.showToast({
        title: error.message || '添加失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },
});
