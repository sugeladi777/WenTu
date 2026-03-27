const app = getApp();

const { callCloudFunction } = require('../../utils/cloud');

Page({
  data: {
    passwordForm: {
      oldPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
    saving: false,
  },

  onLoad() {
    if (!app.checkLogin()) {
      app.goToLogin();
    }
  },

  onPasswordInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) {
      return;
    }

    this.setData({
      [`passwordForm.${field}`]: String(e.detail.value || ''),
    });
  },

  async onSubmit() {
    if (this.data.saving) {
      return;
    }

    const userInfo = app.globalData.userInfo;
    const userId = userInfo && userInfo._id ? userInfo._id : '';
    const oldPassword = String(this.data.passwordForm.oldPassword || '');
    const newPassword = String(this.data.passwordForm.newPassword || '');
    const confirmPassword = String(this.data.passwordForm.confirmPassword || '');

    if (!userId) {
      wx.showToast({ title: '用户信息异常', icon: 'none' });
      return;
    }

    if (!oldPassword || !newPassword || !confirmPassword) {
      wx.showToast({ title: '请填写完整密码信息', icon: 'none' });
      return;
    }

    if (newPassword.length < 6) {
      wx.showToast({ title: '新密码至少 6 位', icon: 'none' });
      return;
    }

    if (newPassword !== confirmPassword) {
      wx.showToast({ title: '两次输入的新密码不一致', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '正在修改' });

    try {
      await callCloudFunction('changePassword', {
        userId,
        oldPassword,
        newPassword,
      });

      this.setData({
        passwordForm: {
          oldPassword: '',
          newPassword: '',
          confirmPassword: '',
        },
      });

      wx.showToast({
        title: '密码已更新',
        icon: 'success',
      });

      setTimeout(() => {
        wx.navigateBack();
      }, 600);
    } catch (error) {
      wx.showToast({
        title: error.message || '修改失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },
});
