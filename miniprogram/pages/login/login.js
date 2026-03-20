// pages/login/login.js
Page({
  data: {
    // 登录表单
    studentId: '',
    password: '',
    // 注册表单
    name: '',
    phone: '',
    // 切换模式
    mode: 'login', // login | register
    loading: false,
  },

  onLoad() {
    // 检查是否已登录
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  // 输入框绑定
  onStudentIdInput(e) {
    this.setData({ studentId: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  // 切换模式
  onToggleMode() {
    this.setData({
      mode: this.data.mode === 'login' ? 'register' : 'login',
    });
  },

  // 提交表单
  onSubmit() {
    const { studentId, password, name, phone, mode } = this.data;

    if (!studentId || !password) {
      wx.showToast({ title: '请填写学号和密码', icon: 'none' });
      return;
    }

    if (mode === 'register') {
      if (!name) {
        wx.showToast({ title: '请输入姓名', icon: 'none' });
        return;
      }
      if (!phone) {
        wx.showToast({ title: '请输入手机号', icon: 'none' });
        return;
      }
      // 验证手机号格式
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        wx.showToast({ title: '手机号格式不正确', icon: 'none' });
        return;
      }
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '请稍候...' });

    const params = {
      studentId,
      password,
      action: mode,
    };

    if (mode === 'register') {
      params.name = name;
      params.phone = phone;
    }

    wx.cloud.callFunction({
      name: 'login',
      data: params,
      success: (res) => {
        wx.hideLoading();
        this.setData({ loading: false });

        if (res.result.success) {
          if (mode === 'login') {
            // 登录成功，保存用户信息
            wx.setStorageSync('userInfo', res.result.userInfo);
            wx.showToast({ title: '登录成功', icon: 'success' });
            setTimeout(() => {
              wx.switchTab({ url: '/pages/index/index' });
            }, 1000);
          } else {
            // 注册成功，切换到登录
            wx.showToast({ title: '注册成功，请登录', icon: 'success' });
            this.setData({
              mode: 'login',
              name: '',
              phone: '',
            });
          }
        } else {
          wx.showToast({ title: res.result.error, icon: 'none' });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        this.setData({ loading: false });
        wx.showToast({ title: '网络错误', icon: 'none' });
        console.error(err);
      },
    });
  },
});
