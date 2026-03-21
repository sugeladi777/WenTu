// pages/myShift/myShift.js
const app = getApp();

Page({
  data: {
    // 学期信息
    semester: null,
    // 我的班次列表
    shiftList: [],
    // 待审批数量
    pendingCount: 0,
    // 调班申请列表
    swapRequests: [],
    // 星期名称映射
    weekDayNames: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    loading: false,
  },

  onLoad() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadMyShifts();
    this.loadSwapRequests();
  },

  onShow() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadMyShifts();
    this.loadSwapRequests();
  },

  // 加载我的班次
  async loadMyShifts() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return;

    this.setData({ loading: true });

    try {
      // 获取当前学期
      const semesterRes = await wx.cloud.callFunction({
        name: 'getCurrentSemester',
      });

      if (semesterRes.result && semesterRes.result.success) {
        this.setData({ semester: semesterRes.result.semester });
        
        // 获取该学期的班次
        const db = wx.cloud.database();
        const today = new Date().toISOString().split('T')[0];
        
        const res = await db.collection('schedules')
          .where({
            userId: userInfo._id,
            semesterId: semesterRes.result.semester._id,
            date: db.command.gte(today), // 只显示今天及以后的
          })
          .orderBy('date', 'asc')
          .get();

        if (res.data && res.data.length > 0) {
          this.setData({ shiftList: res.data });
        } else {
          this.setData({ shiftList: [] });
        }
      }
    } catch (err) {
      console.error('加载班次失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 加载调班申请
  async loadSwapRequests() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return;

    try {
      const db = wx.cloud.database();
      
      // 我发起的调班申请
      const myRequests = await db.collection('shiftRequests')
        .where({
          applicantId: userInfo._id,
        })
        .orderBy('createdAt', 'desc')
        .get();

      // 待我确认的调班申请
      const toConfirm = await db.collection('shiftRequests')
        .where({
          toUserId: userInfo._id,
          status: 'pending',
        })
        .get();

      this.setData({
        swapRequests: [...toConfirm.data || [], ...myRequests.data || []],
        pendingCount: toConfirm.data?.length || 0,
      });
    } catch (err) {
      console.error('加载调班申请失败:', err);
    }
  },

  // 跳转到选择班次页面
  onEditShiftTap() {
    wx.navigateTo({
      url: '/pages/selectSchedule/selectSchedule',
    });
  },

  // 班次点击
  onShiftTap(e) {
    const { id } = e.currentTarget.dataset;
    const shift = this.data.shiftList.find(s => s._id === id);
    if (shift) {
      const weekDayName = this.data.weekDayNames[shift.dayOfWeek] || '未知';
      let statusText = '正常';
      if (shift.status === 'swapped') statusText = '已调班';
      
      wx.showModal({
        title: '班次详情',
        content: `${shift.date} ${weekDayName}\n班次：${shift.shiftName}\n时间：${shift.startTime} - ${shift.endTime}\n状态：${statusText}`,
        showCancel: false,
      });
    }
  },

  // 处理调班申请
  onHandleSwap(e) {
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
        this.loadMyShifts();
        this.loadSwapRequests();
      } else {
        wx.showToast({ title: res.result?.error || '操作失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: '网络错误', icon: 'none' });
      console.error(err);
    }
  },
});
