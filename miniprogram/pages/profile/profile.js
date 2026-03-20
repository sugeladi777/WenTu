// pages/profile/profile.js
const app = getApp();

Page({
  data: {
    userInfo: null,
  },

  onLoad() {
    // 检查登录状态
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadUserInfo();
  },

  onShow() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadUserInfo();
  },

  // 加载用户信息
  loadUserInfo() {
    const userInfo = wx.getStorageSync('userInfo');
    this.setData({ userInfo });
  },

  // 跳转到奖惩记录
  onRewardRecordTap() {
    wx.navigateTo({
      url: '/pages/rewardRecord/rewardRecord',
    });
  },

  // 跳转到签到记录
  onCheckRecordTap() {
    wx.navigateTo({
      url: '/pages/checkRecord/checkRecord',
    });
  },

  // 跳转到设置
  onSettingsTap() {
    wx.navigateTo({
      url: '/pages/settings/settings',
    });
  },

  // 跳转到帮助
  onHelpTap() {
    wx.navigateTo({
      url: '/pages/help/help',
    });
  },

  // 退出登录
  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync();
          app.globalData.userInfo = null;
          app.globalData.isLoggedIn = false;
          wx.redirectTo({
            url: '/pages/login/login',
          });
        }
      },
    });
  },
});
