const app = getApp();

const { callCloudFunction } = require('../../utils/cloud');

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

function getFileExtension(filePath) {
  const match = String(filePath || '').match(/\.[^.\\/]+$/);
  return match ? match[0].toLowerCase() : '.png';
}

function chooseAvatarImage() {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: resolve,
      fail: reject,
    });
  });
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

function uploadFile(cloudPath, filePath) {
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

Page({
  data: {
    userInfo: null,
    displayName: '未登录',
    avatarText: DEFAULT_AVATAR_TEXT,
    avatarUrl: '',
    avatarDraftPath: '',
    profileForm: {
      name: '',
      nickname: '',
    },
    saving: false,
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
    const avatar = currentUser && currentUser.avatar ? String(currentUser.avatar) : '';

    this.setData({
      userInfo: currentUser,
      displayName: getDisplayName(currentUser),
      avatarText: getAvatarText(currentUser),
      avatarUrl: avatar && !isCloudFileId(avatar) ? avatar : '',
      avatarDraftPath: '',
      profileForm: {
        name: currentUser && currentUser.name ? currentUser.name : '',
        nickname: currentUser && currentUser.nickname ? currentUser.nickname : '',
      },
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

  onProfileInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) {
      return;
    }

    this.setData({
      [`profileForm.${field}`]: normalizeText(e.detail.value),
    });
  },

  async onPickAvatar() {
    try {
      const result = await chooseAvatarImage();
      const fileItem = result.tempFiles && result.tempFiles[0];

      if (!fileItem || !fileItem.tempFilePath) {
        return;
      }

      this.setData({
        avatarUrl: fileItem.tempFilePath,
        avatarDraftPath: fileItem.tempFilePath,
      });
    } catch (error) {
      const message = String((error && (error.errMsg || error.message)) || '');
      if (message.includes('cancel')) {
        return;
      }

      wx.showToast({
        title: '选择头像失败',
        icon: 'none',
      });
    }
  },

  async uploadAvatarIfNeeded() {
    const draftPath = this.data.avatarDraftPath;
    if (!draftPath) {
      return this.data.userInfo && this.data.userInfo.avatar
        ? this.data.userInfo.avatar
        : '';
    }

    const userId = this.data.userInfo && this.data.userInfo._id
      ? this.data.userInfo._id
      : 'user';
    const cloudPath = `avatars/${userId}-${Date.now()}${getFileExtension(draftPath)}`;
    const uploadResult = await uploadFile(cloudPath, draftPath);

    if (!uploadResult || !uploadResult.fileID) {
      throw new Error('头像上传失败');
    }

    return uploadResult.fileID;
  },

  async onSaveProfile() {
    if (this.data.saving) {
      return;
    }

    const userInfo = this.data.userInfo;
    const userId = userInfo && userInfo._id ? userInfo._id : '';
    const name = normalizeText(this.data.profileForm.name);
    const nickname = normalizeText(this.data.profileForm.nickname);

    if (!userId) {
      wx.showToast({ title: '用户信息异常', icon: 'none' });
      return;
    }

    if (!name) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '正在保存' });

    try {
      const avatar = await this.uploadAvatarIfNeeded();
      const result = await callCloudFunction('updateUserProfile', {
        userId,
        name,
        nickname,
        avatar,
      });

      const currentUser = app.setUserInfo(result.userInfo, {
        activeRole: app.globalData.userInfo && app.globalData.userInfo.activeRole,
      });

      this.setData({ avatarDraftPath: '' });
      this.loadUserInfo(currentUser);

      wx.showToast({
        title: '资料已保存',
        icon: 'success',
      });

      setTimeout(() => {
        wx.navigateBack();
      }, 600);
    } catch (error) {
      wx.showToast({
        title: error.message || '保存失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },
});
