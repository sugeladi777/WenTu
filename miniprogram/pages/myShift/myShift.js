const app = getApp();

const { USER_ROLE } = require('../../utils/constants');
const { formatDate } = require('../../utils/date');
const { getActiveRole } = require('../../utils/role');
const { buildWeeklyCalendarData, decorateSchedule } = require('../../utils/shift');
const { callCloudFunction } = require('../../utils/cloud');

function sortByDateTime(list = []) {
  return [...list].sort((left, right) => {
    if (left.date !== right.date) {
      return String(left.date || '').localeCompare(String(right.date || ''));
    }

    return String(left.startTime || '').localeCompare(String(right.startTime || ''));
  });
}

function resolveLeaderName(item = {}) {
  return String(
    item.leaderUserName
    || item.leaveReleasedLeaderUserName
    || item.borrowLeaderText
    || '',
  ).trim() || '未安排班负';
}

function isSelfLeader(item = {}, userId = '') {
  const currentUserId = String(userId || '').trim();
  if (!currentUserId) {
    return false;
  }

  const leaderUserId = String(
    item.leaderUserId
    || item.leaveReleasedLeaderUserId
    || '',
  ).trim();

  return Boolean(leaderUserId) && leaderUserId === currentUserId;
}

function decorateMyShift(item, userId) {
  const decorated = decorateSchedule(item);
  const leaderSelf = isSelfLeader(item, userId);

  return {
    ...decorated,
    leaderNameText: resolveLeaderName(item),
    leaderNameClass: leaderSelf ? 'leader-self' : '',
  };
}

Page({
  data: {
    semester: null,
    shiftList: [],
    weeklyShifts: [],
    currentWeekIndex: 0,
    currentWeekLabel: '',
    activeRole: USER_ROLE.MEMBER,
    weekDayNames: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    loading: false,
  },

  onLoad() {
    if (!this.ensureSession()) {
      return;
    }

    this._skipNextOnShowRefresh = true;
    this.loadMyShifts();
  },

  onShow() {
    if (!this.ensureSession()) {
      return;
    }

    if (this._skipNextOnShowRefresh) {
      this._skipNextOnShowRefresh = false;
      return;
    }

    this.loadMyShifts();
  },

  ensureSession() {
    const userInfo = app.globalData.userInfo;
    if (userInfo && userInfo._id) {
      return true;
    }

    if (this._redirectingLogin) {
      return false;
    }

    this._redirectingLogin = true;

    wx.showToast({
      title: '登录状态已失效',
      icon: 'none',
    });

    setTimeout(() => {
      this._redirectingLogin = false;
      app.goToLogin();
    }, 120);

    return false;
  },

  findCurrentWeekIndex(weeklyShifts) {
    if (!weeklyShifts.length) {
      return 0;
    }

    const today = formatDate(new Date());
    const index = weeklyShifts.findIndex((week) => today >= week.weekStart && today <= week.weekEnd);

    if (index !== -1) {
      return index;
    }

    return today < weeklyShifts[0].weekStart ? 0 : weeklyShifts.length - 1;
  },

  applyWeekMeta(index = this.data.currentWeekIndex, weeklyShifts = this.data.weeklyShifts) {
    const currentWeek = weeklyShifts[index] || null;

    this.setData({
      currentWeekLabel: currentWeek ? `${currentWeek.weekStart} 至 ${currentWeek.weekEnd}` : '',
    });
  },

  async loadMyShifts() {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id) {
      wx.showToast({ title: '用户信息缺失', icon: 'none' });
      return;
    }

    const activeRole = getActiveRole(userInfo);

    this.setData({ loading: true });

    try {
      let semester = null;

      try {
        const semesterResult = await callCloudFunction('getCurrentSemester');
        semester = semesterResult.semester || null;
      } catch (error) {
        console.warn('获取学期信息失败:', error);
      }

      const shiftResult = await callCloudFunction('getMyShifts', {
        userId: userInfo._id,
        semesterId: semester ? semester._id : '',
      });

      const shiftList = sortByDateTime((shiftResult.schedules || []).map((item) => {
        return decorateMyShift(item, userInfo._id);
      }));
      const weeklyShifts = buildWeeklyCalendarData(shiftList);
      const currentWeekIndex = this.findCurrentWeekIndex(weeklyShifts);
      const currentWeek = weeklyShifts[currentWeekIndex] || null;

      this.setData({
        semester,
        shiftList,
        weeklyShifts,
        currentWeekIndex,
        currentWeekLabel: currentWeek ? `${currentWeek.weekStart} 至 ${currentWeek.weekEnd}` : '',
        activeRole,
      });
    } catch (error) {
      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none',
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  onWeekChange(e) {
    const currentWeekIndex = e.detail.current;
    this.setData({ currentWeekIndex });
    this.applyWeekMeta(currentWeekIndex);
  },

  onOpenLeaveMarket() {
    wx.navigateTo({
      url: '/pages/leavecenter/leavecenter',
    });
  },

  onOpenBorrowCenter() {
    wx.navigateTo({
      url: '/pages/borrowCenter/borrowCenter',
    });
  },

  openShiftDetail(shift, source = 'my') {
    if (!shift) {
      return;
    }

    const shiftData = encodeURIComponent(JSON.stringify(shift));
    wx.navigateTo({
      url: `/pages/shiftDetail/shiftDetail?shiftData=${shiftData}&source=${source}`,
    });
  },

  onShiftTap(e) {
    const id = e.currentTarget.dataset.id;
    const shift = this.data.shiftList.find((item) => item._id === id);
    this.openShiftDetail(shift, 'my');
  },
});
