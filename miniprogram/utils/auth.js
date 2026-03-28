const { STORAGE_KEYS } = require('./constants');
const { normalizeUserRoles } = require('./role');

function normalizeUserInfo(userInfo, preferredActiveRole) {
  return normalizeUserRoles(userInfo, preferredActiveRole);
}

function getStoredUser() {
  try {
    return normalizeUserInfo(wx.getStorageSync(STORAGE_KEYS.USER_INFO));
  } catch (error) {
    console.warn('读取本地登录态失败:', error);
    return null;
  }
}

function setStoredUser(userInfo, preferredActiveRole) {
  const normalized = normalizeUserInfo(userInfo, preferredActiveRole);
  if (!normalized) {
    return null;
  }

  try {
    wx.setStorageSync(STORAGE_KEYS.USER_INFO, normalized);
  } catch (error) {
    console.warn('写入本地登录态失败:', error);
  }

  return normalized;
}

function clearStoredUser() {
  try {
    wx.removeStorageSync(STORAGE_KEYS.USER_INFO);
  } catch (error) {
    console.warn('清理本地登录态失败:', error);
  }
}

module.exports = {
  clearStoredUser,
  getStoredUser,
  normalizeUserInfo,
  setStoredUser,
};
