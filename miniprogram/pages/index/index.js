const app = getApp();

const {
  ATTENDANCE_STATUS,
  LEAVE_STATUS,
  SHIFT_TYPE,
  USER_ROLE,
} = require('../../utils/constants');
const { callCloudFunction } = require('../../utils/cloud');
const { formatDate, formatTime } = require('../../utils/date');
const { getActiveRole, getRoleText, getRoleTheme } = require('../../utils/role');
const { decorateSchedule, getEffectiveAttendanceStatus, pickCurrentShift } = require('../../utils/shift');

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function getRecordStatusClass(schedule) {
  const attendanceStatus = schedule.effectiveAttendanceStatus != null
    ? schedule.effectiveAttendanceStatus
    : getEffectiveAttendanceStatus(schedule);

  if (attendanceStatus === ATTENDANCE_STATUS.ABSENT) {
    return 'danger';
  }

  if (schedule.shiftType === SHIFT_TYPE.LEAVE) {
    return 'muted';
  }

  if (
    attendanceStatus === ATTENDANCE_STATUS.LATE
    || attendanceStatus === ATTENDANCE_STATUS.MISSING_CHECKOUT
  ) {
    return 'late';
  }

  return '';
}

function getGreetingLabel(hour = new Date().getHours()) {
  if (hour < 6) {
    return '夜深了';
  }

  if (hour < 12) {
    return '早上好';
  }

  if (hour < 18) {
    return '下午好';
  }

  return '晚上好';
}

function getCheckState(shift) {
  if (!shift) {
    return {
      hasCheckedIn: false,
      hasCheckedOut: false,
      checkDisabled: true,
      checkButtonClass: 'checked-out',
      checkButtonText: '暂无班次',
      checkButtonIcon: '休',
      checkHint: '今天没有需要签到签退的班次。',
    };
  }

  const effectiveAttendanceStatus = shift.effectiveAttendanceStatus != null
    ? shift.effectiveAttendanceStatus
    : getEffectiveAttendanceStatus(shift);

  if (shift.shiftType === SHIFT_TYPE.LEAVE) {
    return {
      hasCheckedIn: false,
      hasCheckedOut: true,
      checkDisabled: true,
      checkButtonClass: 'checked-out',
      checkButtonText: '已请假',
      checkButtonIcon: '假',
      checkHint: shift.leaveStatus === LEAVE_STATUS.APPROVED
        ? '该班次已完成请假并已有同学接替。'
        : '该班次已请假，正在等待其他同学认领替班。',
    };
  }

  if (effectiveAttendanceStatus === ATTENDANCE_STATUS.ABSENT) {
    return {
      hasCheckedIn: false,
      hasCheckedOut: false,
      checkDisabled: true,
      checkButtonClass: 'checked-out',
      checkButtonText: '已旷岗',
      checkButtonIcon: '缺',
      checkHint: '该班次未签到，已被记录为旷岗。',
    };
  }

  if (effectiveAttendanceStatus === ATTENDANCE_STATUS.MISSING_CHECKOUT) {
    return {
      hasCheckedIn: true,
      hasCheckedOut: false,
      checkDisabled: true,
      checkButtonClass: 'checked-out',
      checkButtonText: '未签退',
      checkButtonIcon: '退',
      checkHint: '该班次已超过签退时限，系统已记录为未签退。',
    };
  }

  if (shift.checkOutTime) {
    return {
      hasCheckedIn: true,
      hasCheckedOut: true,
      checkDisabled: true,
      checkButtonClass: 'checked-out',
      checkButtonText: '已完成',
      checkButtonIcon: '完',
      checkHint: '当前班次已经完成签到和签退。',
    };
  }

  if (shift.checkInTime) {
    const endMinutes = timeToMinutes(shift.endTime);
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    if (endMinutes !== null && currentMinutes < endMinutes) {
      return {
      hasCheckedIn: true,
      hasCheckedOut: false,
      checkDisabled: true,
      checkButtonClass: 'checked-out',
      checkButtonText: '不可签退',
      checkButtonIcon: '等',
      checkHint: '当前班次尚未结束，请在结束后 30 分钟内完成签退。',
    };
    }

    return {
      hasCheckedIn: true,
      hasCheckedOut: false,
      checkDisabled: false,
      checkButtonClass: 'check-out',
      checkButtonText: '签退',
      checkButtonIcon: '退',
      checkHint: '班次已结束，请在结束后 30 分钟内完成签退。',
    };
  }

  return {
    hasCheckedIn: false,
    hasCheckedOut: false,
    checkDisabled: false,
    checkButtonClass: 'check-in',
    checkButtonText: '签到',
    checkButtonIcon: '到',
    checkHint: '当前班次尚未签到。',
  };
}

function getHeroMeta(activeRole, userName, semester, summary) {
  const semesterName = semester && semester.name ? semester.name : '';

  switch (activeRole) {
    case USER_ROLE.LEADER:
      return {
        title: `${userName}，今天由你带班`,
        subtitle: semesterName
          ? `${semesterName}中，你需要先完成自己的签到签退，再确认当前班次成员的到岗情况。`
          : '班负身份会同时保留你自己的班次操作，并追加班次签到确认任务。',
        badgeValue: '--',
        badgeLabel: '班负视角',
      };
    case USER_ROLE.ADMIN:
      return {
        title: `${userName}，今天从管理视角进入`,
        subtitle: semesterName
          ? `${semesterName}中，你可以查看成员工作情况、任命班负并掌握整体运行状态。`
          : '管理员身份会优先展示成员概况与管理入口。',
        badgeValue: summary && summary.totalUserCount != null ? summary.totalUserCount : '--',
        badgeLabel: '账号总数',
      };
    default:
      return {
        title: `${userName}，今天也稳稳值班`,
        subtitle: semesterName
          ? `${semesterName}中，查看今日班次、完成签到签退和请假替班。`
          : '查看今天的班次安排、签到签退和请假替班信息。',
        badgeValue: '--',
        badgeLabel: '今日班次',
      };
  }
}

function getRoleMission(activeRole) {
  if (activeRole === USER_ROLE.LEADER) {
    return {
      theme: 'leader',
      title: '班负任务',
      desc: '进入签到确认页，确认当前班次成员是否到岗。你自己的签到签退仍在本页完成。',
      buttonText: '去确认签到',
      action: 'leaderConfirm',
    };
  }

  if (activeRole === USER_ROLE.ADMIN) {
    return {
      theme: 'admin',
      title: '管理员任务',
      desc: '查看全员工作情况、调整班负身份；如果你今天也有班次，请先切换到志愿者或班负身份处理。',
      buttonText: '进入管理后台',
      action: 'adminDashboard',
    };
  }

  return null;
}

function buildShortcutItems(activeRole) {
  if (activeRole === USER_ROLE.LEADER) {
    return [
      { key: 'leaderConfirm', title: '班负确认', desc: '确认当前班次成员签到', icon: '签', theme: 'yellow' },
      { key: 'myShift', title: '我的班次', desc: '查看整周安排与请假记录', icon: '班', theme: 'peach' },
      { key: 'leaveCenter', title: '请假与替班', desc: '发布待替班班次或认领替班', icon: '假', theme: 'mint' },
      { key: 'workHours', title: '工时统计', desc: '追踪有效工时', icon: '时', theme: 'blue' },
    ];
  }

  if (activeRole === USER_ROLE.ADMIN) {
    return [
      { key: 'adminDashboard', title: '管理后台', desc: '查看成员工作情况与班负安排', icon: '管', theme: 'blue', wide: true },
      { key: 'profile', title: '身份切换', desc: '切换成志愿者或班负身份处理个人班次', icon: '换', theme: 'peach' },
      { key: 'myShift', title: '我的班次', desc: '查看个人排班信息', icon: '班', theme: 'yellow' },
      { key: 'workHours', title: '工时统计', desc: '查看个人累计工时', icon: '时', theme: 'mint' },
    ];
  }

  return [
    { key: 'myShift', title: '我的班次', desc: '查看整周安排', icon: '班', theme: 'peach' },
    { key: 'workHours', title: '工时统计', desc: '追踪有效工时', icon: '时', theme: 'blue' },
    { key: 'leaveCenter', title: '请假与替班', desc: '发布待替班班次或认领替班', icon: '假', theme: 'mint', wide: true },
  ];
}

function buildShiftStats(todayShifts) {
  const completedShiftCount = todayShifts.filter((item) => {
    return item.checkOutTime
      || item.effectiveAttendanceStatus === ATTENDANCE_STATUS.ABSENT
      || item.effectiveAttendanceStatus === ATTENDANCE_STATUS.MISSING_CHECKOUT
      || item.shiftType === SHIFT_TYPE.LEAVE;
  }).length;

  return {
    completedShiftCount,
    remainingShiftCount: Math.max(0, todayShifts.length - completedShiftCount),
  };
}

function buildMemberStats(todayShifts) {
  const { completedShiftCount, remainingShiftCount } = buildShiftStats(todayShifts);

  return {
    completedShiftCount,
    remainingShiftCount,
    statsCards: [
      { key: 'completed', value: completedShiftCount, label: '已处理', theme: 'warm' },
      { key: 'remaining', value: remainingShiftCount, label: '待完成', theme: 'mint' },
    ],
  };
}

function buildAdminStats(summary) {
  return [
    { key: 'total', value: summary && summary.totalUserCount != null ? summary.totalUserCount : 0, label: '账号总数', theme: 'blue' },
    { key: 'member', value: summary && summary.memberCount != null ? summary.memberCount : 0, label: '普通志愿者', theme: 'warm' },
    { key: 'leader', value: summary && summary.leaderCount != null ? summary.leaderCount : 0, label: '班负身份', theme: 'yellow' },
    { key: 'admin', value: summary && summary.adminCount != null ? summary.adminCount : 0, label: '管理员身份', theme: 'lavender' },
  ];
}

Page({
  data: {
    semester: null,
    todayShifts: [],
    currentShiftIndex: 0,
    currentShift: null,
    todayRecords: [],
    currentTime: '',
    loading: false,
    hasCheckedIn: false,
    hasCheckedOut: false,
    checkDisabled: true,
    checkButtonClass: 'checked-out',
    checkButtonText: '暂无班次',
    checkButtonIcon: '休',
    checkHint: '',
    userName: '',
    greetingLabel: '',
    todayShiftCount: 0,
    completedShiftCount: 0,
    remainingShiftCount: 0,
    currentShiftWindow: '暂无班次',
    currentShiftStatus: '今日暂无安排',
    currentShiftRecordStatusClass: '',
    currentShiftTag: '值班概览',
    activeRole: USER_ROLE.MEMBER,
    roleText: '志愿者',
    roleTheme: 'member',
    heroTitle: '',
    heroSubtitle: '',
    heroBadgeValue: '--',
    heroBadgeLabel: '',
    statsCards: [],
    roleMission: null,
    showShiftWorkspace: true,
  },

  onLoad() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }

    this._skipNextOnShowRefresh = true;
    this.startTimeUpdate();
    this.loadPageData(true);
  },

  onShow() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }

    if (this._skipNextOnShowRefresh) {
      this._skipNextOnShowRefresh = false;
      return;
    }

    this.loadPageData(false);
  },

  onUnload() {
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }

    this.loadPageDataPromise = null;
  },

  startTimeUpdate() {
    this.updateCurrentTime();

    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }

    this.timeInterval = setInterval(() => {
      this.updateCurrentTime();
    }, 15000);
  },

  updateCurrentTime() {
    const now = new Date();
    const nextCurrentTime = formatTime(now);
    const nextGreetingLabel = getGreetingLabel(now.getHours());
    const nextUserName = (app.globalData.userInfo && app.globalData.userInfo.name) || '同学';
    const displayUserName = (
      app.globalData.userInfo
      && (app.globalData.userInfo.nickname || app.globalData.userInfo.name)
    ) || nextUserName;
    const nextState = {};

    if (this.data.currentTime !== nextCurrentTime) {
      nextState.currentTime = nextCurrentTime;
    }

    if (this.data.greetingLabel !== nextGreetingLabel) {
      nextState.greetingLabel = nextGreetingLabel;
    }

    if (this.data.userName !== nextUserName) {
      nextState.userName = nextUserName;
    }

    if (this.data.userName !== displayUserName) {
      nextState.userName = displayUserName;
    }

    if (Object.keys(nextState).length > 0) {
      this.setData(nextState);
    }
  },

  applyRoleMeta(activeRole, userInfo, semester, summary) {
    const heroMeta = getHeroMeta(activeRole, (userInfo && userInfo.name) || '同学', semester, summary);

    return {
      activeRole,
      roleText: getRoleText(activeRole),
      roleTheme: getRoleTheme(activeRole),
      heroTitle: heroMeta.title,
      heroSubtitle: activeRole === USER_ROLE.MEMBER ? '' : heroMeta.subtitle,
      heroBadgeValue: heroMeta.badgeValue,
      heroBadgeLabel: heroMeta.badgeLabel,
      roleMission: getRoleMission(activeRole),
      showShiftWorkspace: activeRole !== USER_ROLE.ADMIN,
    };
  },

  applyShiftList(schedules, semester, preferredShiftId = '') {
    const todayShifts = (schedules || [])
      .map((item) => {
        const decorated = decorateSchedule(item);
        return {
          ...decorated,
          recordStatusClass: getRecordStatusClass(decorated),
        };
      })
      .sort((left, right) => String(left.startTime || '').localeCompare(String(right.startTime || '')));

    const defaultShift = pickCurrentShift(todayShifts);
    const preferredShift = preferredShiftId
      ? todayShifts.find((item) => item._id === preferredShiftId)
      : null;
    const currentShift = preferredShift || defaultShift;
    const currentShiftIndex = currentShift
      ? Math.max(0, todayShifts.findIndex((item) => item._id === currentShift._id))
      : 0;
    const checkState = getCheckState(currentShift);

    return {
      semester: semester || null,
      todayShifts,
      todayRecords: todayShifts,
      currentShift,
      currentShiftIndex,
      todayShiftCount: todayShifts.length,
      completedShiftCount: 0,
      remainingShiftCount: 0,
      statsCards: [],
      currentShiftWindow: currentShift ? `${currentShift.startTime} - ${currentShift.endTime}` : '暂无班次',
      currentShiftStatus: currentShift ? currentShift.attendanceText : '今日暂无安排',
      currentShiftRecordStatusClass: currentShift ? currentShift.recordStatusClass : '',
      currentShiftTag: currentShift ? currentShift.shiftName : '值班概览',
      heroBadgeValue: todayShifts.length,
      ...checkState,
    };
  },

  applyAdminSummary(summary, semester) {
    return {
      semester: semester || null,
      todayShifts: [],
      todayRecords: [],
      currentShift: null,
      currentShiftIndex: 0,
      todayShiftCount: 0,
      completedShiftCount: 0,
      remainingShiftCount: 0,
      currentShiftWindow: '暂无班次',
      currentShiftStatus: '管理员视角',
      currentShiftRecordStatusClass: '',
      currentShiftTag: '管理总览',
      statsCards: buildAdminStats(summary || null),
      heroBadgeValue: summary && summary.totalUserCount != null ? summary.totalUserCount : '--',
      hasCheckedIn: false,
      hasCheckedOut: false,
      checkDisabled: true,
      checkButtonClass: 'checked-out',
      checkButtonText: '切换身份',
      checkButtonIcon: '换',
      checkHint: '管理员身份默认不处理签到签退。',
    };
  },

  async loadPageData(showLoading = false) {
    if (this.loadPageDataPromise) {
      return this.loadPageDataPromise;
    }

    const task = (async () => {
      const userInfo = await app.refreshUserInfo() || app.globalData.userInfo;
      if (!userInfo || !userInfo._id) {
        return;
      }

      const activeRole = getActiveRole(userInfo);
      const displayUserName = userInfo.nickname || userInfo.name || '鍚屽';
      const shouldToggleLoadingState = showLoading || !this._hasPageData;

      if (shouldToggleLoadingState) {
        this.setData({
          loading: true,
          userName: userInfo.name || '同学',
        });
      } else if (this.data.userName !== (userInfo.name || '同学')) {
        this.setData({
          userName: userInfo.name || '同学',
        });
      }

      if (displayUserName !== this.data.userName) {
        this.setData({ userName: displayUserName });
      }

      if (showLoading) {
        wx.showLoading({ title: '加载中' });
      }

      try {
        let semester = null;

        try {
          const semesterResult = await callCloudFunction('getCurrentSemester');
          semester = semesterResult.semester || null;
        } catch (error) {
          console.warn('获取学期信息失败:', error);
        }

        if (activeRole === USER_ROLE.ADMIN) {
          const adminResult = await callCloudFunction('getAdminDashboard', {
            requesterId: userInfo._id,
          });

          this.setData({
            ...this.applyRoleMeta(activeRole, userInfo, semester, adminResult.summary || null),
            ...this.applyAdminSummary(adminResult.summary || null, semester),
          });
          this._hasPageData = true;
          return;
        }

        const shiftResult = await callCloudFunction('getTodayShift', {
          userId: userInfo._id,
          date: formatDate(new Date()),
        });

        this.setData({
          ...this.applyRoleMeta(activeRole, userInfo, semester, null),
          ...this.applyShiftList(shiftResult.schedules || [], semester),
        });
        this._hasPageData = true;
      } catch (error) {
        wx.showToast({
          title: error.message || '加载失败',
          icon: 'none',
        });
      } finally {
        if (showLoading) {
          wx.hideLoading();
        }

        if (shouldToggleLoadingState && this.data.loading) {
          this.setData({ loading: false });
        }
      }
    })();

    this.loadPageDataPromise = task;

    try {
      return await task;
    } finally {
      if (this.loadPageDataPromise === task) {
        this.loadPageDataPromise = null;
      }
    }
  },

  onShiftChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index) || index === this.data.currentShiftIndex) {
      return;
    }

    const currentShift = this.data.todayShifts[index] || null;
    const checkState = getCheckState(currentShift);

    this.setData({
      currentShiftIndex: index,
      currentShift,
      currentShiftWindow: currentShift ? `${currentShift.startTime} - ${currentShift.endTime}` : '暂无班次',
      currentShiftStatus: currentShift ? currentShift.attendanceText : '今日暂无安排',
      currentShiftRecordStatusClass: currentShift ? currentShift.recordStatusClass : '',
      currentShiftTag: currentShift ? currentShift.shiftName : '值班概览',
      ...checkState,
    });
  },

  onCheck() {
    if (this.data.checkDisabled || !this.data.currentShift) {
      return;
    }

    if (this.data.hasCheckedIn) {
      this.onCheckOut();
      return;
    }

    this.onCheckIn();
  },

  async onCheckIn() {
    const userInfo = app.globalData.userInfo;
    const currentShift = this.data.currentShift;

    if (!userInfo || !userInfo._id || !currentShift) {
      wx.showToast({ title: '班次信息异常', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '正在签到' });

    try {
      const result = await callCloudFunction('checkIn', {
        userId: userInfo._id,
        date: formatDate(new Date()),
        scheduleId: currentShift._id,
      });

      wx.showToast({
        title: result.status || '签到成功',
        icon: 'success',
      });

      await this.loadPageData(false);
    } catch (error) {
      wx.showToast({
        title: error.message || '签到失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },

  async onCheckOut() {
    const userInfo = app.globalData.userInfo;
    const currentShift = this.data.currentShift;

    if (!userInfo || !userInfo._id || !currentShift) {
      wx.showToast({ title: '班次信息异常', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '正在签退' });

    try {
      await callCloudFunction('checkOut', {
        userId: userInfo._id,
        date: formatDate(new Date()),
        scheduleId: currentShift._id,
      });

      wx.showToast({
        title: '签退成功',
        icon: 'success',
      });

      await this.loadPageData(false);
    } catch (error) {
      wx.showToast({
        title: error.message || '签退失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },

  onMissionTap() {
    const action = this.data.roleMission ? this.data.roleMission.action : '';
    if (!action) {
      return;
    }

    this.handleAction(action);
  },

  handleAction(action) {
    switch (action) {
      case 'leaderConfirm':
        wx.navigateTo({ url: '/pages/leaderConfirm/leaderConfirm' });
        break;
      case 'adminDashboard':
        wx.navigateTo({ url: '/pages/adminDashboard/adminDashboard' });
        break;
      case 'myShift':
        wx.switchTab({ url: '/pages/myShift/myShift' });
        break;
      case 'leaveCenter':
        wx.navigateTo({ url: '/pages/leavecenter/leavecenter' });
        break;
      case 'workHours':
        wx.switchTab({ url: '/pages/workHours/workHours' });
        break;
      case 'profile':
        wx.switchTab({ url: '/pages/profile/profile' });
        break;
      default:
        break;
    }
  },
});
