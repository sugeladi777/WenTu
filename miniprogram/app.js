// app.js
App({
  onLaunch() {
    // 初始化云开发
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-9g80lw7hb3abc7e1',
        traceUser: true,
      });
    }
  },
  globalData: {
    userInfo: null,
    isLoggedIn: false,
  },
});
