// pages/index/index.js
const app = getApp();

Page({
  data: {
    // 当前学期信息
    semester: null,
    // 今日班次信息
    todayShift: null,
    // 签到状态
    hasCheckedIn: false,
    hasCheckedOut: false,
    // 今日签到记录
    todayRecord: null,
    // 用户信息
    userInfo: null,
    // 待办提醒
    pendingApprovals: [],
    // 待处理的调班申请
    swapRequests: [],
    // 选中的加班时长
    selectedOvertime: 0,
    loading: false,
  },

  onLoad() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.setData({ userInfo: app.globalData.userInfo });
  },

  onShow() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadTodayData();
  },

  // 加载今日数据
  async loadTodayData() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return;

    this.setData({ userInfo });
    wx.showLoading({ title: '加载中...' });

    try {
      // 获取当前学期
      const semesterRes = await wx.cloud.callFunction({
        name: 'getCurrentSemester',
      });

      if (semesterRes.result && semesterRes.result.success) {
        this.setData({ semester: semesterRes.result.semester });
      }

      // 获取今日班次
      const shiftRes = await wx.cloud.callFunction({
        name: 'getTodayShift',
        data: { userId: userInfo._id },
      });

      if (shiftRes.result && shiftRes.result.success) {
        this.setData({ todayShift: shiftRes.result.schedule || null });
      }

      // 获取签到记录
      const db = wx.cloud.database();
      const today = new Date().toISOString().split('T')[0];
      const recordRes = await db.collection('checkRecords')
        .where({ userId: userInfo._id, date: today })
        .get();

      if (recordRes.data && recordRes.data.length > 0) {
        const record = recordRes.data[0];
        this.setData({
          todayRecord: record,
          hasCheckedIn: true,
          hasCheckedOut: !!record.checkOutTime,
          selectedOvertime: record.overtimeHours || 0,
        });
      } else {
        this.setData({
          todayRecord: null,
          hasCheckedIn: false,
          hasCheckedOut: false,
          selectedOvertime: 0,
        });
      }

      // 获取待处理的调班申请
      await this.loadSwapRequests(userInfo._id);

    } catch (err) {
      console.error('加载数据失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 获取待处理的调班申请
  async loadSwapRequests(userId) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('shiftRequests')
        .where({
          toUserId: userId,
          status: 'pending',
        })
        .get();

      this.setData({ swapRequests: res.data || [] });
    } catch (err) {
      console.error('加载调班申请失败:', err);
    }
  },

  // 点击签到/签退按钮
  onCheck() {
    if (this.data.hasCheckedIn) {
      this.onCheckOut();
    } else {
      this.onCheckIn();
    }
  },

  // 选择加班时长
  onSelectOvertime(e) {
    const hours = parseInt(e.currentTarget.dataset.hours);
    this.setData({ selectedOvertime: hours });
  },

  // 签到
  onCheckIn() {
    if (this.data.hasCheckedIn) return;
    
    const userInfo = this.data.userInfo;
    if (!userInfo || !userInfo._id) {
      wx.showToast({ title: '用户信息异常', icon: 'none' });
      return;
    }
    
    this.setData({ loading: true });
    wx.showLoading({ title: '签到中...' });

    wx.cloud.callFunction({
      name: 'checkIn',
      data: {
        userId: userInfo._id,
        date: this.formatDate(new Date()),
      },
    }).then(res => {
      wx.hideLoading();
      this.setData({ loading: false });
      
      if (res.result && res.result.success) {
        wx.showToast({ 
          title: res.result.status || '签到成功', 
          icon: 'success' 
        });
        this.loadTodayData();
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
    
    const overtimeHours = this.data.selectedOvertime;
    const userInfo = this.data.userInfo;
    
    this.setData({ loading: true });
    wx.showLoading({ title: '签退中...' });

    wx.cloud.callFunction({
      name: 'checkOut',
      data: {
        userId: userInfo._id,
        date: this.formatDate(new Date()),
        overtimeHours: overtimeHours,
      },
    }).then(res => {
      wx.hideLoading();
      this.setData({ loading: false });
      
      if (res.result && res.result.success) {
        const msg = overtimeHours > 0 ? `签退成功（加班${overtimeHours}小时）` : '签退成功';
        wx.showToast({ title: msg, icon: 'success' });
        this.loadTodayData();
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

  // 处理调班申请
  onSwapRequest(e) {
    const { requestid, action } = e.currentTarget.dataset;
    
    wx.showModal({
      title: '确认',
      content: action === 'accept' ? '确认接受调班？' : '确认拒绝调班？',
      success: async (res) => {
        if (res.confirm) {
          await this.handleSwapRequest(requestid, action);
        }
      }
    });
  },

  async handleSwapRequest(requestId, action) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'confirmShiftSwap',
        data: { requestId, action },
      });

      if (res.result && res.result.success) {
        wx.showToast({ title: res.result.message, icon: 'success' });
        this.loadTodayData();
      } else {
        wx.showToast({ title: res.result?.error || '操作失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: '网络错误', icon: 'none' });
      console.error(err);
    }
  },

  // 格式化日期
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 格式化时间
  formatTime(date) {
    if (!date) return '--';
    const d = new Date(date);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  },
});
