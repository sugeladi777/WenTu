// pages/login/login.js
Page({
  data: {
    // 登录表单
    studentId: '',
    password: '',
    // 注册表单
    name: '',
    // 切换模式
    mode: 'login', // login | register
    loading: false,
  },

  onLoad() {
    // 检查是否已登录
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo && userInfo._id) {
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

  // 切换模式
  onToggleMode() {
    this.setData({
      mode: this.data.mode === 'login' ? 'register' : 'login',
    });
  },

  // 提交表单
  onSubmit() {
    const { studentId, password, name, mode } = this.data;

    if (!studentId || !password) {
      wx.showToast({ title: '请填写学号和密码', icon: 'none' });
      return;
    }

    if (mode === 'register') {
      if (!name) {
        wx.showToast({ title: '请输入姓名', icon: 'none' });
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
    }

    wx.cloud.callFunction({
      name: 'login',
      data: params,
      success: (res) => {
        wx.hideLoading();
        this.setData({ loading: false });

        if (res.result && res.result.success) {
          const userInfo = res.result.userInfo;
          if (!userInfo || !userInfo._id) {
            wx.showToast({ title: '用户信息获取失败', icon: 'none' });
            return;
          }

          wx.setStorageSync('userInfo', userInfo);

          if (mode === 'login') {
            wx.showToast({ title: '登录成功', icon: 'success' });
            setTimeout(() => {
              wx.switchTab({ url: '/pages/index/index' });
            }, 1000);
          } else {
            wx.showToast({ title: '注册成功', icon: 'success' });
            setTimeout(() => {
              wx.redirectTo({ url: '/pages/selectSchedule/selectSchedule' });
            }, 1000);
          }
        } else {
          wx.showToast({ title: res.result.error || '操作失败', icon: 'none' });
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
