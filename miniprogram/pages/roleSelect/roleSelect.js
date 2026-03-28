const app = getApp();

const { USER_ROLE } = require('../../utils/constants');
const { getActiveRole, getRoleOptions, getRoleText } = require('../../utils/role');

Page({
  data: {
    userInfo: null,
    roleOptions: [],
    selectedRole: USER_ROLE.MEMBER,
    selectedRoleText: getRoleText(USER_ROLE.MEMBER),
    loading: false,
  },

  onLoad() {
    this.bootstrapPage();
  },

  onShow() {
    if (!this.data.userInfo && !this.data.loading) {
      this.bootstrapPage();
    }
  },

  bootstrapPage() {
    if (app.checkLogin()) {
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }

    const pendingUserInfo = app.getPendingLoginUser();
    if (!pendingUserInfo || !pendingUserInfo._id) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    const roleOptions = getRoleOptions(pendingUserInfo);
    const selectedRole = getActiveRole(pendingUserInfo);

    this.setData({
      userInfo: pendingUserInfo,
      roleOptions,
      selectedRole,
      selectedRoleText: getRoleText(selectedRole),
    });
  },

  onSelectRole(e) {
    const role = Number(e.currentTarget.dataset.role);
    if (Number.isNaN(role)) {
      return;
    }

    this.setData({
      selectedRole: role,
      selectedRoleText: getRoleText(role),
    });
  },

  async onConfirmRoleLogin() {
    if (this.data.loading) {
      return;
    }

    const pendingUserInfo = app.getPendingLoginUser() || this.data.userInfo;
    if (!pendingUserInfo || !pendingUserInfo._id) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '正在进入' });

    try {
      const currentUser = app.setUserInfo(pendingUserInfo, {
        activeRole: this.data.selectedRole,
      });

      if (!currentUser) {
        throw new Error('登录状态写入失败');
      }

      wx.showToast({
        title: '登录成功',
        icon: 'success',
      });

      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' });
      }, 800);
    } catch (error) {
      wx.showToast({
        title: error.message || '登录失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },

  onBackToLogin() {
    if (this.data.loading) {
      return;
    }

    app.clearPendingLoginUser();
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.reLaunch({ url: '/pages/login/login' });
      },
    });
  },
});