// pages/index/index.js
const app = getApp();

Page({
  data: {
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
      // 获取今日排班和签到记录
      const scheduleRes = await wx.cloud.callFunction({
        name: 'getTodaySchedule',
        data: {
          userId: userInfo._id,
          date: this.formatDate(new Date()),
        },
      });

      if (scheduleRes.result.success) {
        const { schedule, checkRecord } = scheduleRes.result;
        
        this.setData({
          todayShift: schedule?.shift || null,
          todayRecord: checkRecord || null,
          hasCheckedIn: !!checkRecord,
          hasCheckedOut: checkRecord?.checkOutTime ? true : false,
          selectedOvertime: checkRecord?.overtimeHours || 0,
        });
      }

      // 获取待审批提醒
      await this.loadPendingApprovals(userInfo._id);

    } catch (err) {
      console.error('加载数据失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 加载待审批提醒
  async loadPendingApprovals(userId) {
    try {
      const db = wx.cloud.database();
      
      // 查询待审批的加班申请
      const overtimeRecords = await db.collection('checkRecords')
        .where({
          userId,
          overtimeHours: db.command.gt(0),
          overtimeApproved: false,
        })
        .limit(5)
        .get();

      // 查询待审批的请假
      const leaveRecords = await db.collection('leaves')
        .where({
          userId,
          status: 'pending',
        })
        .limit(5)
        .get();

      const pending = [];
      
      overtimeRecords.data.forEach(record => {
        pending.push({
          type: 'overtime',
          date: record.date,
          message: `${record.date} 加班${record.overtimeHours}小时待审批`,
        });
      });

      leaveRecords.data.forEach(record => {
        pending.push({
          type: 'leave',
          date: record.date,
          message: `${record.date} 请假待审批`,
        });
      });

      this.setData({ pendingApprovals: pending });

    } catch (err) {
      console.error('加载待审批失败:', err);
    }
  },

  // 点击签到/签退按钮
  onCheck() {
    if (this.data.hasCheckedIn) {
      // 签退
      this.onCheckOut();
    } else {
      // 签到
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
    
    this.setData({ loading: true });
    wx.showLoading({ title: '获取位置...' });

    // 获取用户位置
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.doCheckIn(res.latitude, res.longitude);
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ loading: false });
        wx.showModal({
          title: '提示',
          content: '签到需要获取位置权限，请在设置中开启',
          confirmText: '去设置',
          success: (modalRes) => {
            if (modalRes.confirm) {
              wx.openSetting();
            }
          }
        });
      }
    });
  },
116.32847291187238,40.00429438366638
  // 执行签到
  doCheckIn(latitude, longitude) {
    const userInfo = this.data.userInfo;
    
    wx.showLoading({ title: '签到中...' });
    
    wx.cloud.callFunction({
      name: 'checkIn',
      data: {
        userId: userInfo._id,
        scheduleId: null,
        date: this.formatDate(new Date()),
        latitude: latitude,
        longitude: longitude,
      },
    }).then(res => {
      wx.hideLoading();
      this.setData({ loading: false });
      
      if (res.result.success) {
        wx.showToast({ 
          title: res.result.status || '签到成功', 
          icon: 'success' 
        });
        this.loadTodayData();
      } else {
        wx.showToast({ title: res.result.error, icon: 'none' });
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
    
    this.setData({ loading: true });
    wx.showLoading({ title: '签退中...' });

    const userInfo = this.data.userInfo;
    
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
      
      if (res.result.success) {
        const msg = overtimeHours > 0 ? `签退成功（加班${overtimeHours}小时）` : '签退成功';
        wx.showToast({ title: msg, icon: 'success' });
        this.loadTodayData();
      } else {
        wx.showToast({ title: res.result.error, icon: 'none' });
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

  // 格式化时间
  formatTime(date) {
    if (!date) return '--';
    const d = new Date(date);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  },
});
