// pages/workHours/workHours.js
const app = getApp();

Page({
  data: {
    // 汇总数据
    totalHours: 0,
    currentMonth: '',
    // 视图模式
    viewMode: 'month', // day | week | month
    // 工时列表
    workHoursList: [],
    // 日期选择
    selectedDate: '',
  },

  onLoad() {
    // 检查登录状态
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadWorkHours();
  },

  onShow() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadWorkHours();
  },

  // 切换视图模式
  onViewModeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ viewMode: mode });
    this.loadWorkHours();
  },

  // 加载工时数据
  loadWorkHours() {
    const now = new Date();
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    
    this.setData({
      currentMonth: `${now.getFullYear()}年${monthNames[now.getMonth()]}`,
    });

    // TODO: 从云数据库获取工时数据
    // 根据 viewMode 获取日/周/月数据
  },

  // 查看详情
  onItemTap(e) {
    const { date } = e.currentTarget.dataset;
    // TODO: 跳转到详情页
    wx.showModal({
      title: '查看详情',
      content: `日期：${date}`,
      showCancel: false,
    });
  },
});
