const app = getApp();

const { callCloudFunction } = require('../../utils/cloud');
const {
  getStoredPreferredSemesterId,
  setStoredPreferredSemesterId,
} = require('../../utils/semester');

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
    semesterList: [],
    selectedSemesterId: '',
    selectedSemesterIndex: 0,
    canEditSelection: false,
    selectionEditWindowHint: '',
    shiftTemplates: [],
    capacityMatrix: [],
    weekDays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    selectedMatrix: [],
    selectedCount: 0,
    daySelectionSummary: [],
    loading: false,
  },

  onLoad(options = {}) {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }

    this.entrySource = String(options.source || '').trim();
    this.loadData(String(options.semesterId || '').trim() || getStoredPreferredSemesterId());
  },

  syncSelectionSummary(selectedMatrix = this.data.selectedMatrix) {
    const summary = buildSelectionSummary(selectedMatrix, this.data.weekDays);
    this.setData(summary);
  },

  async loadData(preferredSemesterId = this.data.selectedSemesterId || getStoredPreferredSemesterId()) {
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
        semesterId: preferredSemesterId,
      });
      const semesterList = result.semesterList || [];
      const semester = result.semester || null;
      const selectedSemesterId = semester ? String(semester._id || '').trim() : '';
      const selectedSemesterIndex = semesterList.findIndex((item) => {
        return String(item._id || '').trim() === selectedSemesterId;
      });

      const shiftTemplates = result.shiftTemplates || [];
      const capacityMatrix = buildCapacityMatrix(shiftTemplates, result.capacityList || []);
      const selectedMatrix = buildSelectedMatrix(shiftTemplates, result.preferences || []);
      const summary = buildSelectionSummary(selectedMatrix, this.data.weekDays);

      if (selectedSemesterId) {
        setStoredPreferredSemesterId(selectedSemesterId);
      }

      this.setData({
        semester,
        semesterList,
        selectedSemesterId,
        selectedSemesterIndex: selectedSemesterIndex >= 0 ? selectedSemesterIndex : 0,
        canEditSelection: Boolean(result.canEditSelection),
        selectionEditWindowHint: String(result.selectionEditWindowHint || ''),
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
    if (!this.data.canEditSelection) {
      wx.showToast({ title: this.data.selectionEditWindowHint || '当前不可修改排班', icon: 'none' });
      return;
    }

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
    if (!this.data.canEditSelection) {
      wx.showToast({ title: this.data.selectionEditWindowHint || '当前不可修改排班', icon: 'none' });
      return;
    }

    const selectedMatrix = this.data.shiftTemplates.map(() => Array.from({ length: 7 }, () => false));
    this.setData({ selectedMatrix });
    this.syncSelectionSummary(selectedMatrix);
  },

  onSubmit() {
    if (this.data.loading) {
      return;
    }

    if (!this.data.canEditSelection) {
      wx.showToast({ title: this.data.selectionEditWindowHint || '当前不可修改排班', icon: 'none' });
      return;
    }

    const preferences = collectPreferences(this.data.selectedMatrix, this.data.shiftTemplates);
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

  onSemesterChange(e) {
    const selectedSemesterIndex = Number(e.detail.value);
    if (Number.isNaN(selectedSemesterIndex)) {
      return;
    }

    const semester = this.data.semesterList[selectedSemesterIndex] || null;
    if (!semester) {
      return;
    }

    const semesterId = String(semester._id || '').trim();
    if (!semesterId || semesterId === this.data.selectedSemesterId) {
      return;
    }

    this.setData({
      selectedSemesterIndex,
      selectedSemesterId: semesterId,
    });
    setStoredPreferredSemesterId(semesterId);
    this.loadData(semesterId);
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
        wx.switchTab({
          url: this.entrySource === 'myShift' ? '/pages/myShift/myShift' : '/pages/index/index',
        });
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
