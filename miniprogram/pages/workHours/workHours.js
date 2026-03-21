// pages/workHours/workHours.js
const app = getApp();

Page({
  data: {
    // 汇总数据
    totalHours: 0,
    currentMonth: '',
    // 视图模式
    viewMode: 'month', // day | week | month
    // 工时列表
    workHoursList: [],
    // 学期信息
    semester: null,
    // 加载状态
    loading: false,
  },

  onLoad() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadWorkHours();
  },

  onShow() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadWorkHours();
  },

  // 切换视图模式
  onViewModeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ viewMode: mode });
    this.loadWorkHours();
  },

  // 加载工时数据
  async loadWorkHours() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return;

    const now = new Date();
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    
    this.setData({
      currentMonth: `${now.getFullYear()}年${monthNames[now.getMonth()]}`,
      loading: true,
    });

    try {
      // 获取当前学期
      const semesterRes = await wx.cloud.callFunction({
        name: 'getCurrentSemester',
      });

      if (semesterRes.result && semesterRes.result.success) {
        this.setData({ semester: semesterRes.result.semester });
      }

      // 根据视图模式计算日期范围
      const { startDate, endDate } = this.getDateRange(this.data.viewMode, now);

      // 调用云函数获取工时数据
      const res = await wx.cloud.callFunction({
        name: 'getWorkHours',
        data: {
          userId: userInfo._id,
          startDate,
          endDate,
          semesterId: this.data.semester?._id,
        },
      });

      if (res.result && res.result.success) {
        this.setData({
          totalHours: res.result.totalHours || 0,
          workHoursList: res.result.list || [],
        });
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    } catch (err) {
      console.error('加载工时失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 根据视图模式获取日期范围
  getDateRange(mode, now) {
    const year = now.getFullYear();
    const month = now.getMonth();
    
    if (mode === 'month') {
      // 本月
      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;
      return { startDate, endDate };
    } else if (mode === 'week') {
      // 本周（周一到周日）
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const sundayOffset = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
      
      const monday = new Date(now);
      monday.setDate(now.getDate() + mondayOffset);
      const sunday = new Date(now);
      sunday.setDate(now.getDate() + sundayOffset);
      
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { startDate: fmt(monday), endDate: fmt(sunday) };
    } else {
      // 今日
      const today = `${year}-${String(month + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      return { startDate: today, endDate: today };
    }
  },

  // 查看详情
  onItemTap(e) {
    const { date } = e.currentTarget.dataset;
    const record = this.data.workHoursList.find(item => item.date === date);
    
    if (record) {
      const checkInTime = record.checkInTime ? this.formatDateTime(record.checkInTime) : '--';
      const checkOutTime = record.checkOutTime ? this.formatDateTime(record.checkOutTime) : '--';
      
      wx.showModal({
        title: `${date} 工时详情`,
        content: `班次：${record.shiftName || '未排班'}\n班次工时：${record.shiftHours || 0}小时\n加班：${record.overtimeHours || 0}小时\n签到：${checkInTime}\n签退：${checkOutTime}\n实际工时：${record.hours || 0}小时`,
        showCancel: false,
      });
    }
  },

  // 格式化日期时间
  formatDateTime(date) {
    if (!date) return '--';
    const d = new Date(date);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  },
});
