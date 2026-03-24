// pages/shiftDetail/shiftDetail.js
const app = getApp();

Page({
  data: {
    shift: null,
    loading: false,
  },

  onLoad(options) {
    if (options.shiftData) {
      try {
        const shift = JSON.parse(decodeURIComponent(options.shiftData));
        this.setData({ shift });
      } catch (err) {
        console.error('解析班次数据失败:', err);
        wx.showToast({ title: '数据加载失败', icon: 'none' });
      }
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' });
      wx.navigateBack();
    }
  },
});
