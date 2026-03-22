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
