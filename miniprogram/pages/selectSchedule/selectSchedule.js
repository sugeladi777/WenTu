// pages/selectSchedule/selectSchedule.js
const app = getApp();

Page({
  data: {
    semester: null,
    shiftTemplates: [],
    capacityMatrix: [],
    weekDays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    selectedMatrix: [],
    loading: false,
  },

  onLoad() {
    if (!app.checkLogin()) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.loadData();
  },

  async loadData() {
    wx.showLoading({ title: '加载中...' });
    this.setData({ loading: true });

    try {
      // 获取当前学期
      const semesterRes = await wx.cloud.callFunction({
        name: 'getCurrentSemester',
      });

      if (!semesterRes.result?.success) {
        wx.showToast({ title: '暂无学期信息', icon: 'none' });
        return;
      }

      const semester = semesterRes.result.semester;
      this.setData({ semester });

      // 获取班次模板
      const db = wx.cloud.database();
      const templatesRes = await db.collection('shiftTemplates')
        .where({ semesterId: semester._id })
        .get();

      const shiftTemplates = templatesRes.data || [];
      const shiftCount = shiftTemplates.length;

      // 获取容量
      const capacityRes = await wx.cloud.callFunction({
        name: 'getWeeklyCapacity',
        data: { semesterId: semester._id },
      });

      // 构建容量矩阵
      const capacityMatrix = [];
      for (let i = 0; i < shiftCount; i++) {
        capacityMatrix[i] = [];
        for (let j = 0; j < 7; j++) {
          capacityMatrix[i][j] = { remaining: shiftTemplates[i].maxCapacity };
        }
      }

      if (capacityRes.result?.success) {
        capacityRes.result.capacityList.forEach(item => {
          const idx = shiftTemplates.findIndex(t => t._id === item.shiftId);
          if (idx !== -1) {
            capacityMatrix[idx][item.dayOfWeek] = {
              remaining: Math.max(0, item.remaining),
              currentCount: item.currentCount,
              maxCapacity: item.maxCapacity,
            };
          }
        });
      }

      // 初始化选择矩阵（全为 false）
      const selectedMatrix = [];
      for (let i = 0; i < shiftCount; i++) {
        selectedMatrix[i] = [false, false, false, false, false, false, false];
      }

      this.setData({
        shiftTemplates,
        capacityMatrix,
        selectedMatrix,
        loading: false,
      });

      wx.hideLoading();

    } catch (err) {
      console.error('加载失败:', err);
      wx.hideLoading();
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onSelectShift(e) {
    const { shiftidx, dayidx } = e.currentTarget.dataset;
    const { selectedMatrix, capacityMatrix } = this.data;
    
    // 取消选择
    if (selectedMatrix[shiftidx][dayidx]) {
      selectedMatrix[shiftidx][dayidx] = false;
      this.setData({ selectedMatrix: [...selectedMatrix] });
      return;
    }

    // 检查容量
    if (capacityMatrix[shiftidx][dayidx].remaining <= 0) {
      wx.showToast({ title: '该班次已满员', icon: 'none' });
      return;
    }

    // 选中
    selectedMatrix[shiftidx][dayidx] = true;
    this.setData({ selectedMatrix: [...selectedMatrix] });
  },

  async onSubmit() {
    const { selectedMatrix, shiftTemplates, semester } = this.data;
    const userInfo = wx.getStorageSync('userInfo');
    
    if (!semester || !userInfo?._id) {
      wx.showToast({ title: '登录信息异常', icon: 'none' });
      return;
    }

    // 整理选择
    const preferences = [];
    for (let i = 0; i < shiftTemplates.length; i++) {
      for (let j = 0; j < 7; j++) {
        if (selectedMatrix[i]?.[j]) {
          preferences.push({ dayOfWeek: j, shiftId: shiftTemplates[i]._id });
        }
      }
    }

    if (preferences.length === 0) {
      wx.showToast({ title: '请至少选择一个班次', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认提交',
      content: `将保存您的班次选择，确定吗？`,
      success: async (res) => {
        if (res.confirm) {
          await this.saveSelection(preferences, semester, userInfo);
        }
      }
    });
  },

  async saveSelection(preferences, semester, userInfo) {
    this.setData({ loading: true });
    wx.showLoading({ title: '保存中...' });

    try {
      // 1. 保存周选择
      const saveRes = await wx.cloud.callFunction({
        name: 'saveWeeklySelection',
        data: {
          semesterId: semester._id,
          userId: userInfo._id,
          preferences,
        },
      });

      if (!saveRes.result?.success) {
        wx.hideLoading();
        this.setData({ loading: false });
        wx.showToast({ title: '保存失败', icon: 'none' });
        return;
      }

      // 2. 生成班次
      const genRes = await wx.cloud.callFunction({
        name: 'generateSchedules',
        data: {
          semesterId: semester._id,
          userId: userInfo._id,
          userName: userInfo.name || '',
        },
      });

      wx.hideLoading();
      this.setData({ loading: false });

      if (genRes.result?.success) {
        wx.showToast({ title: '保存成功', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 1500);
      } else {
        wx.showToast({ title: '保存成功，生成班次失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ loading: false });
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },
});
