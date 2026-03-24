// pages/index/index.js
const app = getApp();

Page({
  data: {
    // 当前学期信息
    semester: null,
    // 今日班次列表
    todayShifts: [],
    // 当前选中的班次索引
    currentShiftIndex: 0,
    // 当前选中的班次
    currentShift: null,
    // 签到状态
    hasCheckedIn: false,
    hasCheckedOut: false,
    // 今日签到记录（从 schedules 表获取）
    todayRecords: [],
    // 当前时间
    currentTime: '',
    loading: false,
  },

  onLoad() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.setData({ userInfo: app.globalData.userInfo });
    this.loadTodayData(true);
    this.startTimeUpdate();
  },

  onUnload() {
    // 页面卸载时停止定时器
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }
  },

  onShow() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    // 检查是否需要刷新（签到状态可能已变化）
    this.loadTodayData(false);
  },

  // 启动时间更新定时器
  startTimeUpdate() {
    // 立即更新一次
    this.updateCurrentTime();
    // 每秒更新
    this.timeInterval = setInterval(() => {
      this.updateCurrentTime();
    }, 1000);
  },

  // 更新当前时间
  updateCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    this.setData({
      currentTime: `${hours}:${minutes}:${seconds}`
    });
  },

  // 加载今日数据
  async loadTodayData(showLoading = true) {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return;

    this.setData({ userInfo });

    // 缓存键
    const cacheKey = `indexData_${userInfo._id}`;
    const today = new Date().toISOString().split('T')[0];

    // 检查缓存（只缓存今日数据，避免跨天问题）
    const cachedData = wx.getStorageSync(cacheKey);
    if (!showLoading && cachedData && cachedData.date === today) {
      this.setData({
        semester: cachedData.semester,
        todayShifts: cachedData.todayShifts,
        currentShift: cachedData.currentShift,
        currentShiftIndex: cachedData.currentShiftIndex,
        hasCheckedIn: cachedData.hasCheckedIn,
        hasCheckedOut: cachedData.hasCheckedOut,
        todayRecords: cachedData.todayRecords,
      });
      // 后台静默刷新签到状态
      this.refreshCheckStatus();
      return;
    }

    if (showLoading) {
      wx.showLoading({ title: '加载中...' });
    }

    try {
      // 获取当前学期
      const semesterRes = await wx.cloud.callFunction({
        name: 'getCurrentSemester',
      });

      if (semesterRes.result && semesterRes.result.success) {
        this.setData({ semester: semesterRes.result.semester });
      }

      // 获取今日所有班次（从 schedules 表）
      const shiftRes = await wx.cloud.callFunction({
        name: 'getTodayShift',
        data: { userId: userInfo._id },
      });

      if (shiftRes.result && shiftRes.result.success) {
        const todayShifts = shiftRes.result.schedules || [];
        // 按结束时间排序
        todayShifts.sort((a, b) => a.endTime.localeCompare(b.endTime));
        const currentShift = todayShifts.length > 0 ? todayShifts[0] : null;
        
        this.setData({ 
          todayShifts,
          currentShift,
          currentShiftIndex: 0,
        });
      }

      // 直接从 schedules 表获取今日签到状态（包含签到签退信息）
      const schedules = this.data.todayShifts;
      // 格式化时间为时分显示
      const formattedRecords = schedules.map(s => ({
        ...s,
        checkInTimeStr: s.checkInTime ? this.formatTimeStr(s.checkInTime) : null,
        checkOutTimeStr: s.checkOutTime ? this.formatTimeStr(s.checkOutTime) : null,
      }));
      const checkedInRecords = schedules.filter(s => s.checkInTime);
      const checkedOutRecords = checkedInRecords.filter(s => s.checkOutTime);

      this.setData({
        todayRecords: formattedRecords,
        hasCheckedIn: checkedInRecords.length > 0,
        hasCheckedOut: checkedOutRecords.length === checkedInRecords.length && checkedInRecords.length > 0,
      });

      // 缓存数据
      wx.setStorageSync(cacheKey, {
        date: today,
        semester: this.data.semester,
        todayShifts: this.data.todayShifts,
        currentShift: this.data.currentShift,
        currentShiftIndex: 0,
        hasCheckedIn: this.data.hasCheckedIn,
        hasCheckedOut: this.data.hasCheckedOut,
        todayRecords: this.data.todayRecords,
      });

    } catch (err) {
      console.error('加载数据失败:', err);
    } finally {
      if (showLoading) {
        wx.hideLoading();
      }
    }
  },

  // 后台静默刷新签到状态
  async refreshCheckStatus() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return;

    try {
      // 直接从 schedules 表获取最新状态
      const shiftRes = await wx.cloud.callFunction({
        name: 'getTodayShift',
        data: { userId: userInfo._id },
      });

      if (shiftRes.result && shiftRes.result.success) {
        const schedules = shiftRes.result.schedules || [];
        // 格式化时间为时分显示
        const formattedRecords = schedules.map(s => ({
          ...s,
          checkInTimeStr: s.checkInTime ? this.formatTimeStr(s.checkInTime) : null,
          checkOutTimeStr: s.checkOutTime ? this.formatTimeStr(s.checkOutTime) : null,
        }));
        const checkedInRecords = schedules.filter(s => s.checkInTime);
        const checkedOutRecords = checkedInRecords.filter(s => s.checkOutTime);

        this.setData({
          todayShifts: schedules,
          todayRecords: formattedRecords,
          hasCheckedIn: checkedInRecords.length > 0,
          hasCheckedOut: checkedOutRecords.length === checkedInRecords.length && checkedInRecords.length > 0,
          currentShift: schedules.length > 0 ? schedules[0] : null,
        });
      }
    } catch (err) {
      console.error('刷新状态失败:', err);
    }
  },

  // 切换班次
  onShiftChange(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({
      currentShiftIndex: index,
      currentShift: this.data.todayShifts[index],
    });
  },

  // 点击签到/签退按钮
  onCheck() {
    if (this.data.hasCheckedIn) {
      this.onCheckOut();
    } else {
      this.onCheckIn();
    }
  },

  // 签到
  onCheckIn() {
    if (this.data.hasCheckedIn) return;
    
    const userInfo = this.data.userInfo;
    if (!userInfo || !userInfo._id) {
      wx.showToast({ title: '用户信息异常', icon: 'none' });
      return;
    }

    const currentShift = this.data.currentShift;
    if (!currentShift) {
      wx.showToast({ title: '今日无班次', icon: 'none' });
      return;
    }
    
    this.setData({ loading: true });
    wx.showLoading({ title: '签到中...' });

    wx.cloud.callFunction({
      name: 'checkIn',
      data: {
        userId: userInfo._id,
        date: this.formatDate(new Date()),
        scheduleId: currentShift._id,
      },
    }).then(res => {
      wx.hideLoading();
      this.setData({ loading: false });
      
      if (res.result && res.result.success) {
        wx.showToast({ 
          title: res.result.status || '签到成功', 
          icon: 'success' 
        });
        this.loadTodayData(false);
      } else {
        wx.showToast({ title: res.result?.error || '签到失败', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      this.setData({ loading: false });
      wx.showToast({ title: '网络错误', icon: 'none' });
      console.error(err);
    });
  },

  // 签退
  onCheckOut() {
    if (!this.data.hasCheckedIn || this.data.hasCheckedOut) return;
    
    const userInfo = this.data.userInfo;
    
    this.setData({ loading: true });
    wx.showLoading({ title: '签退中...' });

    wx.cloud.callFunction({
      name: 'checkOut',
      data: {
        userId: userInfo._id,
        date: this.formatDate(new Date()),
      },
    }).then(res => {
      wx.hideLoading();
      this.setData({ loading: false });
      
      if (res.result && res.result.success) {
        wx.showToast({ title: '签退成功', icon: 'success' });
        this.loadTodayData(false);
      } else {
        wx.showToast({ title: res.result?.error || '签退失败', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      this.setData({ loading: false });
      wx.showToast({ title: '网络错误', icon: 'none' });
      console.error(err);
    });
  },

  // 格式化日期
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 格式化时间为时分字符串
  formatTimeStr(date) {
    if (!date) return '--';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '--';
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  },
});
