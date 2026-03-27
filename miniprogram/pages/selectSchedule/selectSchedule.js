const app = getApp();

const { callCloudFunction } = require('../../utils/cloud');

function buildCapacityMatrix(shiftTemplates, capacityList) {
  const capacityMap = {};
  (capacityList || []).forEach((item) => {
    capacityMap[`${item.shiftId}::${item.dayOfWeek}`] = item;
  });

  return shiftTemplates.map((template) => {
    return Array.from({ length: 7 }, (_, dayOfWeek) => {
      const capacityItem = capacityMap[`${template._id}::${dayOfWeek}`];
      const maxCapacity = Number(template.maxCapacity) || 0;

      return {
        remaining: capacityItem ? Number(capacityItem.remaining) : maxCapacity,
        currentCount: capacityItem ? Number(capacityItem.currentCount) : 0,
        maxCapacity: capacityItem ? Number(capacityItem.maxCapacity) : maxCapacity,
      };
    });
  });
}

function buildSelectedMatrix(shiftTemplates, preferences) {
  const selectedSet = new Set(
    (preferences || []).map((item) => `${item.shiftId}::${item.dayOfWeek}`)
  );

  return shiftTemplates.map((template) => {
    return Array.from({ length: 7 }, (_, dayOfWeek) => selectedSet.has(`${template._id}::${dayOfWeek}`));
  });
}

function collectPreferences(selectedMatrix, shiftTemplates) {
  const preferences = [];

  shiftTemplates.forEach((template, shiftIndex) => {
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      if (selectedMatrix[shiftIndex] && selectedMatrix[shiftIndex][dayIndex]) {
        preferences.push({
          shiftId: template._id,
          dayOfWeek: dayIndex,
        });
      }
    }
  });

  return preferences;
}

function buildSelectionSummary(selectedMatrix, weekDays) {
  let selectedCount = 0;

  const daySelectionSummary = weekDays.map((day, dayIndex) => {
    let count = 0;

    selectedMatrix.forEach((row) => {
      if (row && row[dayIndex]) {
        count += 1;
        selectedCount += 1;
      }
    });

    return {
      label: day,
      count,
      active: count > 0,
    };
  });

  return {
    selectedCount,
    daySelectionSummary,
  };
}

Page({
  data: {
    semester: null,
    shiftTemplates: [],
    capacityMatrix: [],
    weekDays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    selectedMatrix: [],
    selectedCount: 0,
    daySelectionSummary: [],
    loading: false,
  },

  onLoad() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }

    this.loadData();
  },

  syncSelectionSummary(selectedMatrix = this.data.selectedMatrix) {
    const summary = buildSelectionSummary(selectedMatrix, this.data.weekDays);
    this.setData(summary);
  },

  async loadData() {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id) {
      wx.showToast({ title: '登录信息异常', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '加载中...' });

    try {
      const result = await callCloudFunction('getScheduleSelectionData', {
        userId: userInfo._id,
      });

      if ((result.preferences || []).length > 0) {
        wx.showModal({
          title: '固定班次已锁定',
          content: '当前版本不支持重新选择班次，如需调整请联系负责人处理。',
          showCancel: false,
          success: () => {
            wx.switchTab({ url: '/pages/myShift/myShift' });
          },
        });
        return;
      }

      const shiftTemplates = result.shiftTemplates || [];
      const capacityMatrix = buildCapacityMatrix(shiftTemplates, result.capacityList || []);
      const selectedMatrix = buildSelectedMatrix(shiftTemplates, result.preferences || []);
      const summary = buildSelectionSummary(selectedMatrix, this.data.weekDays);

      this.setData({
        semester: result.semester || null,
        shiftTemplates,
        capacityMatrix,
        selectedMatrix,
        ...summary,
      });
    } catch (error) {
      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },

  onSelectShift(e) {
    const shiftIndex = Number(e.currentTarget.dataset.shiftidx);
    const dayIndex = Number(e.currentTarget.dataset.dayidx);
    const selectedMatrix = this.data.selectedMatrix.map((row) => [...row]);

    if (selectedMatrix[shiftIndex][dayIndex]) {
      selectedMatrix[shiftIndex][dayIndex] = false;
      this.setData({ selectedMatrix });
      this.syncSelectionSummary(selectedMatrix);
      return;
    }

    if ((this.data.capacityMatrix[shiftIndex][dayIndex].remaining || 0) <= 0) {
      wx.showToast({ title: '该班次已满员', icon: 'none' });
      return;
    }

    selectedMatrix[shiftIndex][dayIndex] = true;
    this.setData({ selectedMatrix });
    this.syncSelectionSummary(selectedMatrix);
  },

  onResetSelection() {
    const selectedMatrix = this.data.shiftTemplates.map(() => Array.from({ length: 7 }, () => false));
    this.setData({ selectedMatrix });
    this.syncSelectionSummary(selectedMatrix);
  },

  onSubmit() {
    if (this.data.loading) {
      return;
    }

    const preferences = collectPreferences(this.data.selectedMatrix, this.data.shiftTemplates);
    if (preferences.length === 0) {
      wx.showToast({ title: '请至少选择一个班次', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认提交',
      content: '提交后将重新生成未来班次安排，确定继续吗？',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        await this.saveSelection(preferences);
      },
    });
  },

  async saveSelection(preferences) {
    const userInfo = app.globalData.userInfo;
    const semester = this.data.semester;

    if (!userInfo || !userInfo._id || !semester || !semester._id) {
      wx.showToast({ title: '学期信息异常', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '保存中...' });

    try {
      await callCloudFunction('saveWeeklySelection', {
        semesterId: semester._id,
        userId: userInfo._id,
        preferences,
      });

      await callCloudFunction('generateSchedules', {
        semesterId: semester._id,
        userId: userInfo._id,
        userName: userInfo.name || '',
      });

      wx.showToast({
        title: '保存成功',
        icon: 'success',
      });

      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' });
      }, 800);
    } catch (error) {
      wx.showToast({
        title: error.message || '保存失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },
});
