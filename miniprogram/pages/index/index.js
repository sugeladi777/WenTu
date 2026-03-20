// pages/index/index.js
const app = getApp();

Page({
  data: {
    // 今日班次信息
    todayShift: null,
    // 签到状态
    hasCheckedIn: false,
    hasCheckedOut: false,
    // 今日签到记录
    todayRecord: null,
    // 用户信息
    userInfo: null,
  },

  onLoad() {
    // 检查登录状态
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.setData({ userInfo: app.globalData.userInfo });
  },

  onShow() {
    // 每次显示页面时刷新数据
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadTodayData();
  },

  // 加载今日数据
  loadTodayData() {
    // TODO: 从云数据库获取今日班次和签到状态
    const userInfo = wx.getStorageSync('userInfo');
    this.setData({ userInfo });
  },

  // 签到
  onCheckIn() {
    // TODO: 调用云函数签到
    wx.showLoading({ title: '签到中...' });
    // 模拟签到
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({ title: '签到成功', icon: 'success' });
      this.loadTodayData();
    }, 1000);
  },

  // 签退
  onCheckOut(e) {
    const overtimeHours = e.currentTarget.dataset.hours || 0;
    // TODO: 调用云函数签退，记录加班时长
    wx.showLoading({ title: '签退中...' });
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({ title: '签退成功', icon: 'success' });
      this.loadTodayData();
    }, 1000);
  },
});
