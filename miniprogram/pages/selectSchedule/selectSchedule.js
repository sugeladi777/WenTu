// pages/selectSchedule/selectSchedule.js
const app = getApp();

Page({
  data: {
    // 当前学期信息
    semester: null,
    // 班次模板列表
    shiftTemplates: [],
    // 班次容量 - 二维数组 [shiftIdx][dayIdx]
    capacityMatrix: [],
    // 星期列表
    weekDays: [
      { dayIndex: 0, dayName: '周一' },
      { dayIndex: 1, dayName: '周二' },
      { dayIndex: 2, dayName: '周三' },
      { dayIndex: 3, dayName: '周四' },
      { dayIndex: 4, dayName: '周五' },
      { dayIndex: 5, dayName: '周六' },
      { dayIndex: 6, dayName: '周日' },
    ],
    // 用户选择的班次 - 二维数组 [shiftIdx][dayIdx]
    selectedMatrix: [],
    loading: false,
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/login/login' });
      }, 1500);
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

      if (!semesterRes.result || !semesterRes.result.success) {
        wx.showToast({ title: '暂无学期信息', icon: 'none' });
        return;
      }

      const semester = semesterRes.result.semester;
      
      // 获取班次模板
      const db = wx.cloud.database();
      const templatesRes = await db.collection('shiftTemplates')
        .where({ semesterId: semester._id })
        .get();

      // 获取班次容量
      const capacityRes = await wx.cloud.callFunction({
        name: 'getShiftCapacity',
        data: { semesterId: semester._id },
      });

      // 构建容量矩阵 [shiftIdx][dayIdx]
      const shiftCount = templatesRes.data.length;
      const capacityMatrix = [];
      for (let i = 0; i < shiftCount; i++) {
        capacityMatrix.push([]);
        for (let j = 0; j < 7; j++) {
          capacityMatrix[i].push({ remaining: templatesRes.data[i].maxCapacity });
        }
      }

      // 填充实际容量数据
      if (capacityRes.result && capacityRes.result.success) {
        capacityRes.result.capacityList.forEach(item => {
          const shiftIdx = templatesRes.data.findIndex(t => t._id === item.shiftId);
          if (shiftIdx !== -1) {
            capacityMatrix[shiftIdx][item.dayOfWeek] = {
              remaining: item.remaining,
              currentCount: item.currentCount,
              maxCapacity: item.maxCapacity,
            };
          }
        });
      }

      // 初始化选择矩阵
      const selectedMatrix = [];
      for (let i = 0; i < shiftCount; i++) {
        selectedMatrix.push([false, false, false, false, false, false, false]);
      }

      this.setData({
        semester,
        shiftTemplates: templatesRes.data,
        capacityMatrix,
        selectedMatrix,
      });

    } catch (err) {
      console.error('加载数据失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  onSelectShift(e) {
    const { shiftidx, dayidx } = e.currentTarget.dataset;
    const { selectedMatrix, capacityMatrix } = this.data;
    const capacity = capacityMatrix[shiftidx][dayidx];
    
    // 取消选择
    if (selectedMatrix[shiftidx][dayidx]) {
      const matrix = JSON.parse(JSON.stringify(selectedMatrix));
      matrix[shiftidx][dayidx] = false;
      this.setData({ selectedMatrix: matrix });
      return;
    }

    // 检查是否满员
    if (capacity.remaining <= 0) {
      wx.showToast({ title: '该班次已满员', icon: 'none' });
      return;
    }

    // 选中该班次
    const matrix = JSON.parse(JSON.stringify(selectedMatrix));
    
    // 同一列（同一星期）只能选一个
    for (let i = 0; i < matrix.length; i++) {
      matrix[i][dayidx] = false;
    }
    
    matrix[shiftidx][dayidx] = true;
    this.setData({ selectedMatrix: matrix });
  },

  async onSubmit() {
    const { selectedMatrix, shiftTemplates, semester } = this.data;
    
    if (!semester) {
      wx.showToast({ title: '无学期信息', icon: 'none' });
      return;
    }

    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    // 整理选中的班次
    const preferences = [];
    for (let i = 0; i < shiftTemplates.length; i++) {
      for (let j = 0; j < 7; j++) {
        if (selectedMatrix[i] && selectedMatrix[i][j]) {
          preferences.push({
            dayOfWeek: j,
            shiftId: shiftTemplates[i]._id,
          });
        }
      }
    }

    if (preferences.length === 0) {
      wx.showToast({ title: '请至少选择一个班次', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认提交',
      content: `将生成${semester.name}的班次，确定吗？`,
      success: async (res) => {
        if (res.confirm) {
          this.submitShifts(preferences, semester, userInfo);
        }
      }
    });
  },

  async submitShifts(preferences, semester, userInfo) {
    this.setData({ loading: true });
    wx.showLoading({ title: '保存中...' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'selectShifts',
        data: {
          semesterId: semester._id,
          userId: userInfo._id,
          userName: userInfo.name || '',
          preferences,
        },
      });

      wx.hideLoading();
      this.setData({ loading: false });

      if (res.result && res.result.success) {
        wx.showToast({ 
          title: res.result.message || '班次保存成功', 
          icon: 'success' 
        });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/index/index' });
        }, 1500);
      } else {
        wx.showToast({ title: res.result?.error || '保存失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ loading: false });
      wx.showToast({ title: '网络错误', icon: 'none' });
      console.error(err);
    }
  },
});
