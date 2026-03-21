// pages/selectSchedule/selectSchedule.js
Page({
  data: {
    // 星期列表 (dayIndex: 0=周一, 1=周二, ..., 6=周日)
    weekDays: [
      { dayIndex: 0, dayName: '周一' },
      { dayIndex: 1, dayName: '周二' },
      { dayIndex: 2, dayName: '周三' },
      { dayIndex: 3, dayName: '周四' },
      { dayIndex: 4, dayName: '周五' },
      { dayIndex: 5, dayName: '周六' },
      { dayIndex: 6, dayName: '周日' },
    ],
    // 班次列表 - 硬编码
    shifts: [
      { _id: 'shift1', name: '早班', startTime: '08:00', endTime: '9:30' },
      { _id: 'shift2', name: '午班', startTime: '13:00', endTime: '15:00' },
      { _id: 'shift3', name: '晚一', startTime: '18:00', endTime: '20:00' },
      { _id: 'shift4', name: '晚二', startTime: '20:00', endTime: '22:00' },
    ],
    // 用户选择的班次 - 初始化为4x7的false数组
    selectedMatrix: [
      [false, false, false, false, false, false, false],
      [false, false, false, false, false, false, false],
      [false, false, false, false, false, false, false],
      [false, false, false, false, false, false, false],
    ],
    loading: false,
  },

  onLoad() {
    // 检查登录状态
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/login/login' });
      }, 1500);
      return;
    }
  },

  // 切换班次选择
  onToggleShift(e) {
    const { shiftidx, dayidx } = e.currentTarget.dataset;
    const matrix = JSON.parse(JSON.stringify(this.data.selectedMatrix));
    matrix[shiftidx][dayidx] = !matrix[shiftidx][dayidx];
    this.setData({ selectedMatrix: matrix });
  },

  // 提交班次
  onSubmit() {
    const { selectedMatrix } = this.data;
    const shifts = this.data.shifts;

    // 获取用户信息
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    // 计算本周周一的日期
    const today = new Date();
    const currentDay = today.getDay();
    let monday = new Date(today);
    const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
    monday.setDate(today.getDate() - daysFromMonday);

    // 整理选中的班次
    const schedules = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 7; j++) {
        if (selectedMatrix[i] && selectedMatrix[i][j]) {
          const shiftDate = new Date(monday);
          shiftDate.setDate(monday.getDate() + j);
          const shift = shifts[i];
          schedules.push({
            date: this.formatDate(shiftDate),
            shiftId: shift._id,
            shiftName: shift.name,
            startTime: shift.startTime,
            endTime: shift.endTime,
          });
        }
      }
    }

    if (schedules.length === 0) {
      wx.showToast({ title: '请至少选择一个班次', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '保存中...' });

    wx.cloud.callFunction({
      name: 'saveSchedule',
      data: {
        userId: userInfo._id,
        schedules: schedules,
      },
    }).then(res => {
      wx.hideLoading();
      this.setData({ loading: false });

      if (res.result && res.result.success) {
        wx.showToast({ title: '班次保存成功', icon: 'success' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/index/index' });
        }, 1500);
      } else {
        wx.showToast({ title: res.result?.error || '保存失败', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      this.setData({ loading: false });
      wx.showToast({ title: '网络错误', icon: 'none' });
      console.error(err);
    });
  },

  // 格式化日期 YYYY-MM-DD
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
});
