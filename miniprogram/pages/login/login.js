const app = getApp();

const { USER_ROLE } = require('../../utils/constants');
const { callCloudFunction } = require('../../utils/cloud');
const { getActiveRole, getRoleOptions, getRoleText } = require('../../utils/role');

Page({
  data: {
    studentId: '',
    password: '',
    name: '',
    nickname: '',
    mode: 'login',
    loading: false,
    showRoleSelector: false,
    pendingUserInfo: null,
    roleOptions: [],
    selectedRole: USER_ROLE.MEMBER,
    selectedRoleText: getRoleText(USER_ROLE.MEMBER),
  },

  onLoad() {
    this.tryRestoreSession();
  },

  onShow() {
    this.tryRestoreSession();
  },

  tryRestoreSession() {
    if (this._restoringSession) {
      return;
    }

    const currentUser = app.globalData.userInfo;
    if (currentUser && currentUser._id) {
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }

    this._restoringSession = true;

    setTimeout(() => {
      const restored = app.bootstrapSession(true);
      this._restoringSession = false;

      if (restored && app.globalData.userInfo && app.globalData.userInfo._id) {
        wx.switchTab({ url: '/pages/index/index' });
      }
    }, 60);
  },

  onStudentIdInput(e) {
    this.setData({ studentId: String(e.detail.value || '').trim() });
  },

  onPasswordInput(e) {
    this.setData({ password: String(e.detail.value || '') });
  },

  onNameInput(e) {
    this.setData({ name: String(e.detail.value || '').trim() });
  },

  onNicknameInput(e) {
    this.setData({ nickname: String(e.detail.value || '').trim() });
  },

  resetRoleSelector() {
    this.setData({
      showRoleSelector: false,
      pendingUserInfo: null,
      roleOptions: [],
      selectedRole: USER_ROLE.MEMBER,
      selectedRoleText: getRoleText(USER_ROLE.MEMBER),
    });
  },

  setMode(mode) {
    if (!mode || mode === this.data.mode) {
      return;
    }

    this.resetRoleSelector();
    this.setData({ mode });
  },

  onToggleMode() {
    this.setMode(this.data.mode === 'login' ? 'register' : 'login');
  },

  onChangeMode(e) {
    this.setMode(e.currentTarget.dataset.mode);
  },

  openRoleSelector(userInfo) {
    const selectedRole = getActiveRole(userInfo);
    this.setData({
      showRoleSelector: true,
      pendingUserInfo: userInfo,
      roleOptions: getRoleOptions(userInfo),
      selectedRole,
      selectedRoleText: getRoleText(selectedRole),
    });
  },

  async finishAuth(userInfo, { isRegister, activeRole }) {
    const currentUser = app.setUserInfo(userInfo, { activeRole });
    if (!currentUser) {
      throw new Error('用户信息写入失败');
    }

    this.resetRoleSelector();

    wx.showToast({
      title: isRegister ? '注册成功' : '登录成功',
      icon: 'success',
    });

    setTimeout(() => {
      if (isRegister) {
        wx.redirectTo({ url: '/pages/selectSchedule/selectSchedule' });
        return;
      }

      wx.switchTab({ url: '/pages/index/index' });
    }, 800);
  },

  async onSubmit() {
    if (this.data.loading) {
      return;
    }

    const studentId = this.data.studentId.trim();
    const password = this.data.password;
    const name = this.data.name.trim();
    const nickname = this.data.nickname.trim();
    const isRegister = this.data.mode === 'register';

    if (!studentId || !password) {
      wx.showToast({ title: '请填写学号和密码', icon: 'none' });
      return;
    }

    if (isRegister && !name) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: isRegister ? '正在注册' : '正在登录' });

    try {
      const result = await callCloudFunction('login', {
        studentId,
        password,
        action: this.data.mode,
        name,
        nickname,
      });

      const userInfo = result.userInfo || null;
      if (!userInfo) {
        throw new Error('用户信息获取失败');
      }

      if (!isRegister && getRoleOptions(userInfo).length > 1) {
        this.openRoleSelector(userInfo);
        return;
      }

      await this.finishAuth(userInfo, {
        isRegister,
        activeRole: getActiveRole(userInfo),
      });
    } catch (error) {
      wx.showToast({
        title: error.message || '操作失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
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
    if (this.data.loading || !this.data.pendingUserInfo) {
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '正在进入' });

    try {
      await this.finishAuth(this.data.pendingUserInfo, {
        isRegister: false,
        activeRole: this.data.selectedRole,
      });
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
});
