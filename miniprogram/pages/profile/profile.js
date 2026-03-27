const app = getApp();

const { USER_ROLE } = require('../../utils/constants');
const {
  formatGrantedRoles,
  getActiveRole,
  getRoleOptions,
  getRoleText,
  getRoleTheme,
} = require('../../utils/role');

const DEFAULT_AVATAR_TEXT = '文';

function normalizeText(value, maxLength = 30) {
  return String(value || '').trim().slice(0, maxLength);
}

function getDisplayName(userInfo) {
  return normalizeText(userInfo && userInfo.nickname)
    || normalizeText(userInfo && userInfo.name)
    || '未登录';
}

function getAvatarText(userInfo) {
  const displayName = getDisplayName(userInfo);
  return displayName ? String(displayName).slice(0, 1) : DEFAULT_AVATAR_TEXT;
}

function isCloudFileId(value) {
  return String(value || '').trim().startsWith('cloud://');
}

function getTempFileURL(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: resolve,
      fail: reject,
    });
  });
}

Page({
  data: {
    userInfo: null,
    activeRole: USER_ROLE.MEMBER,
    roleText: getRoleText(USER_ROLE.MEMBER),
    roleTheme: getRoleTheme(USER_ROLE.MEMBER),
    grantedRolesText: '',
    roleOptions: [],
    displayName: '未登录',
    avatarText: DEFAULT_AVATAR_TEXT,
    avatarUrl: '',
  },

  onLoad() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }

    this._skipNextOnShowRefresh = true;
    this.bootstrapPage();
  },

  onShow() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }

    if (this._skipNextOnShowRefresh) {
      this._skipNextOnShowRefresh = false;
      return;
    }

    this.bootstrapPage();
  },

  async bootstrapPage() {
    const userInfo = await app.refreshUserInfo();
    this.loadUserInfo(userInfo || app.globalData.userInfo);
  },

  loadUserInfo(userInfo) {
    const currentUser = userInfo || app.globalData.userInfo || null;
    const activeRole = getActiveRole(currentUser);
    const avatar = currentUser && currentUser.avatar ? String(currentUser.avatar) : '';

    this.setData({
      userInfo: currentUser,
      activeRole,
      roleText: getRoleText(activeRole),
      roleTheme: getRoleTheme(activeRole),
      grantedRolesText: formatGrantedRoles(currentUser),
      roleOptions: getRoleOptions(currentUser),
      displayName: getDisplayName(currentUser),
      avatarText: getAvatarText(currentUser),
      avatarUrl: avatar && !isCloudFileId(avatar) ? avatar : '',
    });

    this.resolveAvatarUrl(avatar);
  },

  async resolveAvatarUrl(avatar) {
    const avatarValue = String(avatar || '').trim();
    const requestId = Date.now();
    this._avatarRequestId = requestId;

    if (!avatarValue) {
      if (this.data.avatarUrl) {
        this.setData({ avatarUrl: '' });
      }
      return;
    }

    if (!isCloudFileId(avatarValue)) {
      if (this._avatarRequestId === requestId) {
        this.setData({ avatarUrl: avatarValue });
      }
      return;
    }

    try {
      const result = await getTempFileURL(avatarValue);
      const fileItem = result.fileList && result.fileList[0];
      const tempFileURL = fileItem && (fileItem.tempFileURL || fileItem.fileID)
        ? (fileItem.tempFileURL || fileItem.fileID)
        : '';

      if (this._avatarRequestId === requestId) {
        this.setData({ avatarUrl: tempFileURL });
      }
    } catch (error) {
      console.warn('解析头像失败:', error);
      if (this._avatarRequestId === requestId) {
        this.setData({ avatarUrl: '' });
      }
    }
  },

  onOpenProfileEdit() {
    wx.navigateTo({
      url: '/pages/profileEdit/profileEdit',
    });
  },

  onOpenPasswordEdit() {
    wx.navigateTo({
      url: '/pages/passwordEdit/passwordEdit',
    });
  },

  onSwitchRole(e) {
    const role = Number(e.currentTarget.dataset.role);
    if (Number.isNaN(role) || role === this.data.activeRole) {
      return;
    }

    const userInfo = app.setActiveRole(role);
    if (!userInfo) {
      return;
    }

    this.loadUserInfo(userInfo);
    wx.showToast({
      title: `已切换为${getRoleText(role)}`,
      icon: 'none',
    });
  },

  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '退出后需要重新登录，确定继续吗？',
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        app.clearUserSession();
        wx.reLaunch({
          url: '/pages/login/login',
        });
      },
    });
  },
});
