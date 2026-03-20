// pages/myShift/myShift.js
Page({
  data: {
    // 我的班次列表
    shiftList: [],
    // 待审批数量
    pendingCount: 0,
  },

  onLoad() {
    this.loadMyShifts();
  },

  onShow() {
    this.loadMyShifts();
  },

  // 加载我的班次
  loadMyShifts() {
    // TODO: 从云数据库获取我的班次列表
  },

  // 跳转到请假页面
  onLeaveTap() {
    wx.navigateTo({
      url: '/pages/leave/leave',
    });
  },

  // 跳转到替班页面
  onShiftChangeTap() {
    wx.navigateTo({
      url: '/pages/shiftChange/shiftChange',
    });
  },

  // 班次点击
  onShiftTap(e) {
    const { id } = e.currentTarget.dataset;
    // TODO: 跳转到班次详情
  },
});
