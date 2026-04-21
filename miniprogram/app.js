const { clearStoredUser, getStoredUser, setStoredUser } = require('./utils/auth');
const { getActiveRole } = require('./utils/role');
const { clearStoredPreferredSemesterId } = require('./utils/semester');

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 及以上基础库以启用云能力');
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
    sessionBootstrapped: false,
    pendingLoginUserInfo: null,
  },

  bootstrapSession(force = false) {
    if (this.globalData.sessionBootstrapped && !force) {
      return this.globalData.isLoggedIn;
    }

    const userInfo = getStoredUser();
    this.globalData.userInfo = userInfo;
    this.globalData.isLoggedIn = Boolean(userInfo && userInfo._id);
    this.globalData.sessionBootstrapped = true;
    return this.globalData.isLoggedIn;
  },

  checkLogin() {
    return Boolean(this.globalData.userInfo && this.globalData.userInfo._id);
  },

  setUserInfo(userInfo, options = {}) {
    const normalized = setStoredUser(userInfo, options.activeRole);
    this.globalData.userInfo = normalized;
    this.globalData.isLoggedIn = Boolean(normalized && normalized._id);
    this.globalData.sessionBootstrapped = true;
    this.globalData.pendingLoginUserInfo = null;
    return normalized;
  },

  setPendingLoginUser(userInfo) {
    this.globalData.pendingLoginUserInfo = userInfo && userInfo._id ? userInfo : null;
    return this.globalData.pendingLoginUserInfo;
  },

  getPendingLoginUser() {
    return this.globalData.pendingLoginUserInfo;
  },

  clearPendingLoginUser() {
    this.globalData.pendingLoginUserInfo = null;
  },

  setActiveRole(role) {
    const currentUser = this.globalData.userInfo || (this.bootstrapSession(true) ? this.globalData.userInfo : null);
    if (!currentUser) {
      return null;
    }

    return this.setUserInfo(currentUser, { activeRole: role });
  },

  async refreshUserInfo() {
    const currentUser = this.globalData.userInfo || (this.bootstrapSession(true) ? this.globalData.userInfo : null);
    if (!currentUser || !currentUser._id) {
      return null;
    }

    try {
      const response = await wx.cloud.callFunction({
        name: 'getUserProfile',
        data: {
          userId: currentUser._id,
        },
      });

      const result = response && response.result;
      if (!result || result.success === false || !result.userInfo) {
        return currentUser;
      }

      return this.setUserInfo(result.userInfo, {
        activeRole: getActiveRole(currentUser),
      });
    } catch (error) {
      console.warn('刷新用户资料失败:', error);
      return currentUser;
    }
  },

  clearUserSession() {
    clearStoredUser();
    clearStoredPreferredSemesterId();
    this.globalData.userInfo = null;
    this.globalData.isLoggedIn = false;
    this.globalData.sessionBootstrapped = true;
    this.globalData.pendingLoginUserInfo = null;
  },

  goToLogin() {
    this.clearPendingLoginUser();
    wx.reLaunch({
      url: '/pages/login/login',
    });
  },
});
