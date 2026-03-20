// app.js
App({
  onLaunch() {
    // 初始化云开发
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-9g80lw7hb3abc7e1', // 替换为你的云开发环境ID
        traceUser: true,
      });
    }
  },

  // 全局数据
  globalData: {
    userInfo: null,
    isLoggedIn: false,
  },

  // 检查登录状态
  checkLogin() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      this.globalData.isLoggedIn = true;
      return true;
    }
    this.globalData.userInfo = null;
    this.globalData.isLoggedIn = false;
    return false;
  },

  // 跳转登录页
  goToLogin() {
    wx.redirectTo({
      url: '/pages/login/login',
    });
  },
});
