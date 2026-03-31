const app = getApp();

const { SHIFT_TYPE, USER_ROLE } = require('../../utils/constants');
const { callCloudFunction } = require('../../utils/cloud');
const { formatDate, formatDateTime } = require('../../utils/date');
const { formatGrantedRoles, getActiveRole, hasRole } = require('../../utils/role');
const { buildWeeklyCalendarData, decorateSchedule } = require('../../utils/shift');

const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function roundNumber(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatHours(value) {
  return String(roundNumber(value));
}

function formatMoney(value) {
  return roundNumber(value).toFixed(2);
}

function getRoleClass(userInfo) {
  if (hasRole(userInfo, USER_ROLE.ADMIN)) {
    return 'admin';
  }

  if (hasRole(userInfo, USER_ROLE.LEADER)) {
    return 'leader';
  }

  return 'member';
}

function getRoleBadgeText(userInfo) {
  if (hasRole(userInfo, USER_ROLE.ADMIN)) {
    return '管理员';
  }

  if (hasRole(userInfo, USER_ROLE.LEADER)) {
    return '班负';
  }

  return '志愿者';
}

function getScheduleDayOfWeek(schedule = {}) {
  const rawDayOfWeek = Number(schedule.dayOfWeek);
  if (!Number.isNaN(rawDayOfWeek) && rawDayOfWeek >= 0 && rawDayOfWeek <= 6) {
    return rawDayOfWeek;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(schedule.date || ''));
  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
}

function buildShiftRowKey(item = {}) {
  if (item.shiftId) {
    return `shift:${item.shiftId}`;
  }

  return `time:${item.shiftName || ''}::${item.startTime || ''}::${item.endTime || ''}`;
}

function compareSchedules(left = {}, right = {}) {
  if (left.date !== right.date) {
    return String(left.date || '').localeCompare(String(right.date || ''));
  }

  return String(left.startTime || '').localeCompare(String(right.startTime || ''));
}

function resolveLeaderName(item = {}) {
  return String(
    item.leaderUserName
    || item.leaveReleasedLeaderUserName
    || '',
  ).trim() || '未安排班负';
}

function isTargetLeader(item = {}, targetUserId = '') {
  const currentTargetUserId = String(targetUserId || '').trim();
  if (!currentTargetUserId) {
    return false;
  }

  const leaderUserId = String(
    item.leaderUserId
    || item.leaveReleasedLeaderUserId
    || '',
  ).trim();

  return Boolean(leaderUserId) && leaderUserId === currentTargetUserId;
}

Page({
  data: {
    loading: false,
    leaderActionScheduleId: '',
    semester: null,
    userInfo: null,
    weekDays: WEEK_DAYS,
    weekDayNames: WEEK_DAYS,
    overviewCards: [],
    attendanceCards: [],
    salaryCards: [],
    shiftList: [],
    shiftTableRows: [],
    selectedSlotKey: '',
    selectedShiftSlot: null,
    weeklyShifts: [],
    currentWeekIndex: 0,
    currentWeekLabel: '',
  },

  async onLoad(options) {
    this.targetUserId = String(options.userId || '').trim();
    if (!this.targetUserId) {
      wx.showToast({ title: '用户参数缺失', icon: 'none' });
      setTimeout(() => {
        wx.navigateBack({
          delta: 1,
          fail: () => {
            wx.reLaunch({ url: '/pages/adminDashboard/adminDashboard' });
          },
        });
      }, 400);
      return;
    }

    this._skipNextOnShowRefresh = true;
    await this.bootstrapPage(true);
  },

  async onShow() {
    if (this._skipNextOnShowRefresh) {
      this._skipNextOnShowRefresh = false;
      return;
    }

    await this.bootstrapPage(false);
  },

  async bootstrapPage(showLoading = false) {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }

    const currentUser = await app.refreshUserInfo();
    if (!currentUser || getActiveRole(currentUser) !== USER_ROLE.ADMIN) {
      wx.showToast({ title: '请以管理员身份进入', icon: 'none' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/profile/profile' });
      }, 500);
      return;
    }

    await this.loadDetail(showLoading);
  },

  buildUserInfo(userInfo, semester) {
    return {
      ...userInfo,
      displayName: userInfo.name || '未命名用户',
      createdAtText: formatDateTime(userInfo.createdAt),
      updatedAtText: formatDateTime(userInfo.updatedAt),
      roleClass: getRoleClass(userInfo),
      roleBadgeText: getRoleBadgeText(userInfo),
      grantedRolesText: formatGrantedRoles(userInfo),
      semesterName: semester ? semester.name : '暂无学期',
      semesterRange: semester ? `${semester.startDate} 至 ${semester.endDate}` : '暂无学期信息',
    };
  },

  buildOverviewCards(summary = {}) {
    return [
      { label: '总班次', value: Number(summary.totalShifts || 0) },
      { label: '已完成', value: Number(summary.completedShifts || 0) },
      { label: '有效工时', value: formatHours(summary.validHours || 0) },
      { label: '请假班次', value: Number(summary.leaveShifts || 0) },
    ];
  },

  buildAttendanceCards(summary = {}) {
    return [
      { label: '已签到', value: Number(summary.checkedInCount || 0) },
      { label: '已签退', value: Number(summary.checkedOutCount || 0) },
      { label: '迟到', value: Number(summary.lateShifts || 0) },
      { label: '旷岗', value: Number(summary.absentShifts || 0) },
      { label: '未签退', value: Number(summary.missingCheckoutShifts || 0) },
    ];
  },

  buildSalaryCards(summary = {}) {
    return [
      { label: '已发班次', value: Number(summary.paidShiftCount || 0) },
      { label: '已发工时', value: formatHours(summary.paidHours || 0) },
      { label: '已发工资', value: `¥${formatMoney(summary.paidAmount || 0)}` },
      { label: '待发班次', value: Number(summary.unpaidShiftCount || 0) },
      { label: '待发工时', value: formatHours(summary.unpaidHours || 0) },
    ];
  },

  buildLeaderMeta(item) {
    const targetUserId = this.targetUserId;
    const leaderUserId = String(item.leaderUserId || '').trim();
    const leaderUserName = String(item.leaderUserName || '').trim();
    const isTargetLeader = leaderUserId && leaderUserId === targetUserId;

    if (item.shiftType === SHIFT_TYPE.LEAVE) {
      return {
        canManageLeader: false,
        leaderAction: '',
        leaderActionText: '请假记录不可任命',
        leaderActionClass: 'disabled',
        leaderActionHint: '请在正常班次记录上任命班负。',
        leaderDisplayText: leaderUserName ? `当前班负：${leaderUserName}` : '当前班负：未任命',
        leaderDisplayClass: leaderUserName ? 'assigned' : 'empty',
      };
    }

    if (isTargetLeader) {
      return {
        canManageLeader: true,
        leaderAction: 'clear',
        leaderActionText: '撤销班负',
        leaderActionClass: 'outline',
        leaderActionHint: '该志愿者已负责本学期这个固定班次。',
        leaderDisplayText: '当前班负：本人',
        leaderDisplayClass: 'self',
      };
    }

    if (!leaderUserId) {
      return {
        canManageLeader: true,
        leaderAction: 'assign',
        leaderActionText: '任命为班负',
        leaderActionClass: '',
        leaderActionHint: '当前固定班次尚未任命班负。',
        leaderDisplayText: '当前班负：未任命',
        leaderDisplayClass: 'empty',
      };
    }

    return {
      canManageLeader: true,
      leaderAction: 'assign',
      leaderActionText: '改派为班负',
      leaderActionClass: '',
      leaderActionHint: `当前班负：${leaderUserName}`,
      leaderDisplayText: `当前班负：${leaderUserName}`,
      leaderDisplayClass: 'assigned',
    };
  },

  buildShiftList(schedules = []) {
    return schedules.map((item) => {
      const decorated = decorateSchedule(item);
      const isPaid = Boolean(item.salaryPaid);
      const isPayable = Boolean(item.isValid);
      const leaderMeta = this.buildLeaderMeta(item);

      return {
        ...decorated,
        ...leaderMeta,
        leaderNameText: resolveLeaderName(item),
        leaderNameClass: isTargetLeader(item, this.targetUserId) ? 'leader-self' : '',
        actualHoursText: formatHours(item.actualHours || item.hours || 0),
        fixedHoursText: formatHours(item.fixedHours || 0),
        timeRange: `${item.startTime || '--'} - ${item.endTime || '--'}`,
        checkInText: item.checkInTime ? decorated.checkInTimeLabel : '未签到',
        checkOutText: item.checkOutTime ? decorated.checkOutTimeLabel : '未签退',
        salaryText: isPaid
          ? `已发 ¥${formatMoney(item.salaryAmount || 0)}`
          : (isPayable ? '待发工资' : '不计工资'),
        salaryClass: isPaid ? 'paid' : (isPayable ? 'pending' : 'muted'),
        salarySubtext: isPaid
          ? `发放时间 ${decorated.salaryPaidAtLabel}`
          : (isPayable ? '该班次已计入待发工资。' : '该班次当前不计入工资。'),
      };
    });
  },

  findCurrentWeekIndex(weeklyShifts = []) {
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

  pickRepresentativeSchedule(slotSchedules = []) {
    const sortedSchedules = slotSchedules.slice().sort(compareSchedules);
    const nonLeaveSchedules = sortedSchedules.filter((item) => item.shiftType !== SHIFT_TYPE.LEAVE);
    const targetLeaderSchedule = nonLeaveSchedules.find((item) => {
      return String(item.leaderUserId || '').trim() === this.targetUserId;
    });
    if (targetLeaderSchedule) {
      return targetLeaderSchedule;
    }

    const assignedLeaderSchedule = nonLeaveSchedules.find((item) => {
      return String(item.leaderUserId || '').trim();
    });
    if (assignedLeaderSchedule) {
      return assignedLeaderSchedule;
    }

    return nonLeaveSchedules[0] || sortedSchedules[0] || null;
  },

  buildShiftSlot(slotSchedules = [], rowMeta = {}, dayOfWeek) {
    const representative = this.pickRepresentativeSchedule(slotSchedules);
    if (!representative) {
      return null;
    }

    const leaderMeta = this.buildLeaderMeta(representative);
    const leaderUserId = String(representative.leaderUserId || '').trim();
    const leaderUserName = String(representative.leaderUserName || '').trim();
    const isTargetLeader = leaderUserId && leaderUserId === this.targetUserId;
    const leaveOccurrenceCount = slotSchedules.filter((item) => item.shiftType === SHIFT_TYPE.LEAVE).length;
    const slotStateClass = !leaderMeta.canManageLeader
      ? 'disabled'
      : (isTargetLeader ? 'self' : (leaderUserId ? 'assigned' : 'empty'));

    let cellTitle = '未任命';
    let cellSubtitle = '点击设置';

    if (!leaderMeta.canManageLeader) {
      cellTitle = '不可任命';
      cellSubtitle = '仅请假记录';
    } else if (isTargetLeader) {
      cellTitle = '本人负责';
      cellSubtitle = '班负';
    } else if (leaderUserName) {
      cellTitle = '已任命';
      cellSubtitle = leaderUserName;
    }

    return {
      slotKey: `${rowMeta.rowKey}::${dayOfWeek}`,
      scheduleId: representative._id,
      schedule: representative,
      shiftName: rowMeta.shiftName,
      timeRange: rowMeta.timeRange,
      fixedHoursText: rowMeta.fixedHoursText,
      weekdayText: WEEK_DAYS[dayOfWeek] || '',
      sampleDate: representative.date || '',
      totalOccurrenceCount: slotSchedules.length,
      leaveOccurrenceCount,
      leaderDisplayText: leaderMeta.leaderDisplayText,
      leaderDisplayClass: leaderMeta.leaderDisplayClass,
      leaderActionText: leaderMeta.leaderActionText,
      leaderActionClass: leaderMeta.leaderActionClass,
      leaderActionHint: leaderMeta.leaderActionHint,
      leaderAction: leaderMeta.leaderAction,
      canManageLeader: leaderMeta.canManageLeader,
      slotStateClass,
      cellTitle,
      cellSubtitle,
    };
  },

  buildShiftTableRows(schedules = [], preferredSlotKey = '') {
    const rowMap = {};

    schedules.forEach((item) => {
      const dayOfWeek = getScheduleDayOfWeek(item);
      if (dayOfWeek === null) {
        return;
      }

      const rowKey = buildShiftRowKey(item);
      if (!rowMap[rowKey]) {
        rowMap[rowKey] = {
          rowKey,
          shiftName: item.shiftName || '未命名班次',
          startTime: item.startTime || '--',
          endTime: item.endTime || '--',
          timeRange: `${item.startTime || '--'} - ${item.endTime || '--'}`,
          fixedHoursText: formatHours(item.fixedHours || 0),
          dayScheduleMap: {},
        };
      }

      if (!rowMap[rowKey].dayScheduleMap[dayOfWeek]) {
        rowMap[rowKey].dayScheduleMap[dayOfWeek] = [];
      }

      rowMap[rowKey].dayScheduleMap[dayOfWeek].push(item);
    });

    const slotMap = {};
    const shiftTableRows = Object.values(rowMap)
      .sort((left, right) => {
        const timeCompare = String(left.startTime || '').localeCompare(String(right.startTime || ''));
        if (timeCompare !== 0) {
          return timeCompare;
        }

        return String(left.shiftName || '').localeCompare(String(right.shiftName || ''));
      })
      .map((row) => {
        const cells = WEEK_DAYS.map((_, dayOfWeek) => {
          const slotSchedules = row.dayScheduleMap[dayOfWeek] || [];
          const slot = slotSchedules.length ? this.buildShiftSlot(slotSchedules, row, dayOfWeek) : null;
          if (slot) {
            slotMap[slot.slotKey] = slot;
          }
          return slot;
        });

        return {
          ...row,
          cells,
        };
      });

    const selectedShiftSlot = slotMap[preferredSlotKey]
      || Object.values(slotMap)[0]
      || null;

    this.shiftSlotMap = slotMap;

    return {
      shiftTableRows,
      selectedSlotKey: selectedShiftSlot ? selectedShiftSlot.slotKey : '',
      selectedShiftSlot,
    };
  },

  async loadDetail(showLoading = false) {
    const requester = app.globalData.userInfo;
    if (!requester || !requester._id) {
      return;
    }

    this.setData({ loading: true });
    if (showLoading) {
      wx.showLoading({ title: '加载中' });
    }

    try {
      const result = await callCloudFunction('getAdminUserDetail', {
        requesterId: requester._id,
        targetUserId: this.targetUserId,
      });

      const semester = result.semester || null;
      const userInfo = this.buildUserInfo(result.userInfo || {}, semester);
      const summary = result.summary || {};
      const shiftList = this.buildShiftList(result.schedules || []);
      const fixedShiftList = shiftList.filter((item) => {
        return item.shiftType !== SHIFT_TYPE.SWAP && item.shiftType !== SHIFT_TYPE.BORROW;
      });
      const shiftTable = this.buildShiftTableRows(
        fixedShiftList,
        this.data.selectedSlotKey || '',
      );
      const weeklyShifts = buildWeeklyCalendarData(shiftList);
      const currentWeekIndex = this.findCurrentWeekIndex(weeklyShifts);
      const currentWeek = weeklyShifts[currentWeekIndex] || null;

      this.setData({
        semester,
        userInfo,
        overviewCards: this.buildOverviewCards(summary),
        attendanceCards: this.buildAttendanceCards(summary),
        salaryCards: this.buildSalaryCards(summary),
        shiftList,
        shiftTableRows: shiftTable.shiftTableRows,
        selectedSlotKey: shiftTable.selectedSlotKey,
        selectedShiftSlot: shiftTable.selectedShiftSlot,
        weeklyShifts,
        currentWeekIndex,
        currentWeekLabel: currentWeek ? `${currentWeek.weekStart} 至 ${currentWeek.weekEnd}` : '',
      });
    } catch (error) {
      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none',
      });
    } finally {
      if (showLoading) {
        wx.hideLoading();
      }
      this.setData({ loading: false });
    }
  },

  onSelectShiftSlot(e) {
    const slotKey = String(e.currentTarget.dataset.key || '').trim();
    const slot = this.shiftSlotMap ? this.shiftSlotMap[slotKey] : null;

    if (!slot || slotKey === this.data.selectedSlotKey) {
      return;
    }

    this.setData({
      selectedSlotKey: slotKey,
      selectedShiftSlot: slot,
    });
  },

  onWeekChange(e) {
    const currentWeekIndex = Number(e.detail.current);
    const currentWeek = this.data.weeklyShifts[currentWeekIndex] || null;

    this.setData({
      currentWeekIndex,
      currentWeekLabel: currentWeek ? `${currentWeek.weekStart} 至 ${currentWeek.weekEnd}` : '',
    });
  },

  onOpenShift(e) {
    const shiftId = String(e.currentTarget.dataset.id || '').trim();
    const shift = this.data.shiftList.find((item) => item._id === shiftId);
    if (!shift) {
      return;
    }

    const shiftData = encodeURIComponent(JSON.stringify(shift));
    wx.navigateTo({
      url: `/pages/shiftDetail/shiftDetail?shiftData=${shiftData}&source=admin`,
    });
  },

  onToggleShiftLeader(e) {
    const scheduleId = String(e.currentTarget.dataset.id || '').trim();
    const action = String(e.currentTarget.dataset.action || '').trim();
    const shift = this.data.shiftList.find((item) => item._id === scheduleId);
    const { userInfo, loading, leaderActionScheduleId } = this.data;

    if (!shift || !userInfo || loading || leaderActionScheduleId) {
      return;
    }

    let content = '';
    if (action === 'clear') {
      content = `确定撤销 ${userInfo.displayName} 在本学期这个固定班次上的班负身份吗？`;
    } else if (shift.leaderUserName && String(shift.leaderUserId || '').trim() !== this.targetUserId) {
      content = `确定将本学期这个固定班次的班负从 ${shift.leaderUserName} 改派为 ${userInfo.displayName} 吗？`;
    } else {
      content = `确定任命 ${userInfo.displayName} 为本学期这个固定班次的班负吗？`;
    }

    wx.showModal({
      title: '确认操作',
      content,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        await this.submitShiftLeaderChange(scheduleId, action);
      },
    });
  },

  async submitShiftLeaderChange(scheduleId, action) {
    const requester = app.globalData.userInfo;
    if (!requester || !requester._id) {
      return;
    }

    this.setData({
      loading: true,
      leaderActionScheduleId: scheduleId,
    });
    wx.showLoading({ title: '提交中' });

    try {
      const result = await callCloudFunction('setShiftLeader', {
        requesterId: requester._id,
        scheduleId,
        action,
      });

      wx.showToast({
        title: result.message || '操作成功',
        icon: 'success',
      });

      await this.loadDetail(false);
    } catch (error) {
      wx.showToast({
        title: error.message || '操作失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({
        loading: false,
        leaderActionScheduleId: '',
      });
    }
  },
});
