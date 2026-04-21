const { STORAGE_KEYS } = require('./constants');

function normalizeSemesterId(value) {
  return String(value || '').trim();
}

function getStoredPreferredSemesterId() {
  try {
    return normalizeSemesterId(wx.getStorageSync(STORAGE_KEYS.PREFERRED_SEMESTER_ID));
  } catch (error) {
    console.warn('读取学期偏好失败:', error);
    return '';
  }
}

function setStoredPreferredSemesterId(semesterId) {
  const normalized = normalizeSemesterId(semesterId);

  try {
    if (!normalized) {
      wx.removeStorageSync(STORAGE_KEYS.PREFERRED_SEMESTER_ID);
    } else {
      wx.setStorageSync(STORAGE_KEYS.PREFERRED_SEMESTER_ID, normalized);
    }
  } catch (error) {
    console.warn('写入学期偏好失败:', error);
  }

  return normalized;
}

function clearStoredPreferredSemesterId() {
  try {
    wx.removeStorageSync(STORAGE_KEYS.PREFERRED_SEMESTER_ID);
  } catch (error) {
    console.warn('清理学期偏好失败:', error);
  }
}

module.exports = {
  getStoredPreferredSemesterId,
  setStoredPreferredSemesterId,
  clearStoredPreferredSemesterId,
};
