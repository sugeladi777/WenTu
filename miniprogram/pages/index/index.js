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

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function getRecordStatusClass(schedule) {
  const attendanceStatus = schedule.effectiveAttendanceStatus != null
    ? schedule.effectiveAttendanceStatus
    : getEffectiveAttendanceStatus(schedule);

  if (attendanceStatus === ATTENDANCE_STATUS.ABSENT) {
    return 'danger';
  }

  if (Number(schedule.shiftType) === SHIFT_TYPE.LEAVE) {
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
      checkHint: '今天没有需要处理的班次。',
    };
  }

  const effectiveAttendanceStatus = shift.effectiveAttendanceStatus != null
    ? shift.effectiveAttendanceStatus
    : getEffectiveAttendanceStatus(shift);

  if (Number(shift.shiftType) === SHIFT_TYPE.LEAVE) {
    return {
      hasCheckedIn: false,
      hasCheckedOut: true,
      checkDisabled: true,
      checkButtonClass: 'checked-out',
      checkButtonText: '已请假',
      checkButtonIcon: '假',
      checkHint: shift.leaveStatus === LEAVE_STATUS.APPROVED
        ? '该班次已完成请假并已有人接替。'
        : '该班次已提交请假，等待其他同学认领。',
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
      checkHint: '该班次未签到，已记为旷岗。',
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
      checkHint: '该班次超过签退时限，已记为未签退。',
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
      checkHint: '当前班次已完成签到和签退。',
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
        checkButtonText: '暂不可签退',
        checkButtonIcon: '签',
        checkHint: '班次结束后才能签退，请在结束后 30 分钟内完成。',
      };
    }

    return {
      hasCheckedIn: true,
      hasCheckedOut: false,
      checkDisabled: false,
      checkButtonClass: 'check-out',
      checkButtonText: '签退',
      checkButtonIcon: '退',
      checkHint: '班次已结束，请尽快完成签退。',
    };
  }

  const startMinutes = timeToMinutes(shift.startTime);
  const endMinutes = timeToMinutes(shift.endTime);
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (startMinutes !== null && currentMinutes < startMinutes) {
    return {
      hasCheckedIn: false,
      hasCheckedOut: false,
      checkDisabled: true,
      checkButtonClass: 'checked-out',
      checkButtonText: '未开始',
      checkButtonIcon: '待',
      checkHint: `班次开始后才能签到，请在 ${shift.startTime} 后签到。`,
    };
  }

  if (endMinutes !== null && currentMinutes > endMinutes) {
    return {
      hasCheckedIn: false,
      hasCheckedOut: false,
      checkDisabled: true,
      checkButtonClass: 'checked-out',
      checkButtonText: '已结束',
      checkButtonIcon: '过',
      checkHint: '已超过班次时间，不能签到。',
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
        title: `${userName}，今天由你负责班次`,
        subtitle: semesterName
          ? `${semesterName}，先完成自己的签到签退，再确认当前班次成员到岗情况。`
          : '先完成自己的签到签退，再确认当前班次成员到岗情况。',
        badgeValue: '--',
        badgeLabel: '班负视角',
      };
    case USER_ROLE.ADMIN:
      return {
        title: `${userName}，当前为管理员视角`,
        subtitle: semesterName
          ? `${semesterName}，查看成员情况、班负安排和工资发放。`
          : '查看成员情况、班负安排和工资发放。',
        badgeValue: summary && summary.totalUserCount != null ? summary.totalUserCount : '--',
        badgeLabel: '账号总数',
      };
    default:
      return {
        title: `${userName}，今天也要顺利值班`,
        subtitle: semesterName
          ? `${semesterName}，查看今日班次并完成签到签退。`
          : '查看今日班次并完成签到签退。',
        badgeValue: '--',
        badgeLabel: '今日班次',
      };
  }
}

function getRoleMission(activeRole) {
  if (activeRole === USER_ROLE.LEADER) {
    return {
      theme: 'leader',
      title: '班负工作',
      desc: '进入确认页，处理当前班次成员签到和加班审批。',
      buttonText: '进入确认页',
      action: 'leaderConfirm',
    };
  }

  if (activeRole === USER_ROLE.ADMIN) {
    return {
      theme: 'admin',
      title: '管理工作',
      desc: '进入后台查看志愿者详情、班负安排和工资发放。',
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
      { key: 'myShift', title: '我的班次', desc: '查看整周安排', icon: '班', theme: 'peach' },
      { key: 'leaveCenter', title: '请假与替班', desc: '查看可替班班次', icon: '假', theme: 'mint' },
      { key: 'workHours', title: '工时统计', desc: '查看有效工时', icon: '时', theme: 'blue' },
    ];
  }

  if (activeRole === USER_ROLE.ADMIN) {
    return [
      { key: 'adminDashboard', title: '管理后台', desc: '查看成员情况与班负安排', icon: '管', theme: 'blue', wide: true },
      { key: 'profile', title: '身份切换', desc: '切换当前使用身份', icon: '换', theme: 'peach' },
      { key: 'myShift', title: '我的班次', desc: '查看个人排班', icon: '班', theme: 'yellow' },
      { key: 'workHours', title: '工时统计', desc: '查看累计工时', icon: '时', theme: 'mint' },
    ];
  }

  return [
    { key: 'myShift', title: '我的班次', desc: '查看整周安排', icon: '班', theme: 'peach' },
    { key: 'workHours', title: '工时统计', desc: '查看有效工时', icon: '时', theme: 'blue' },
    { key: 'leaveCenter', title: '请假与替班', desc: '查看可替班班次', icon: '假', theme: 'mint', wide: true },
  ];
}

function buildShiftStats(todayShifts) {
  const completedShiftCount = todayShifts.filter((item) => {
    return item.checkOutTime
      || item.effectiveAttendanceStatus === ATTENDANCE_STATUS.ABSENT
      || item.effectiveAttendanceStatus === ATTENDANCE_STATUS.MISSING_CHECKOUT
      || Number(item.shiftType) === SHIFT_TYPE.LEAVE;
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
      { key: 'completed', value: completedShiftCount, label: '已完成', theme: 'warm' },
      { key: 'remaining', value: remainingShiftCount, label: '待处理', theme: 'mint' },
    ],
  };
}

function buildAdminStats(summary) {
  return [
    { key: 'total', value: summary && summary.totalUserCount != null ? summary.totalUserCount : 0, label: '账号总数', theme: 'blue' },
    { key: 'member', value: summary && summary.memberCount != null ? summary.memberCount : 0, label: '志愿者', theme: 'warm' },
    { key: 'leader', value: summary && summary.leaderCount != null ? summary.leaderCount : 0, label: '班负', theme: 'yellow' },
    { key: 'admin', value: summary && summary.adminCount != null ? summary.adminCount : 0, label: '管理员', theme: 'lavender' },
  ];
}

const WEEKDAY_TEXTS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function buildAdminLeaderApplications(applications = []) {
  return applications.map((item) => {
    const weekdayIndex = Number(item.dayOfWeek);
    return {
      ...item,
      weekdayText: WEEKDAY_TEXTS[weekdayIndex] || '未设置',
      applicantText: `${item.userName || '未命名用户'} · 学号 ${item.studentId || '未填写'}`,
      timeRange: `${item.startTime || '--'} - ${item.endTime || '--'}`,
      leaderText: item.currentLeaderUserName ? `当前班负：${item.currentLeaderUserName}` : '当前班负：未任命',
    };
  });
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
    currentShiftTag: '班次概览',
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
    leaderApplications: [],
    reviewingApplicationId: '',
    batchReviewing: false,
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

    if (this.data.currentShift) {
      Object.assign(nextState, getCheckState(this.data.currentShift));
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
      currentShiftTag: currentShift ? currentShift.shiftName : '班次概览',
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

  applyAdminApplications(leaderApplications = []) {
    return {
      leaderApplications: buildAdminLeaderApplications(leaderApplications),
      reviewingApplicationId: '',
      batchReviewing: false,
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
      const displayUserName = userInfo.name || '同学';
      const shouldToggleLoadingState = showLoading || !this._hasPageData;

      if (shouldToggleLoadingState) {
        this.setData({
          loading: true,
          userName: displayUserName,
        });
      } else if (this.data.userName !== displayUserName) {
        this.setData({
          userName: displayUserName,
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
          const adminSemester = adminResult.semester || semester;

          this.setData({
            ...this.applyRoleMeta(activeRole, userInfo, adminSemester, adminResult.summary || null),
            ...this.applyAdminSummary(adminResult.summary || null, adminSemester),
            ...this.applyAdminApplications(adminResult.leaderApplications || []),
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
      currentShiftTag: currentShift ? currentShift.shiftName : '班次概览',
      ...checkState,
    });
  },

  onCheck() {
    if (this.data.loading) {
      wx.showToast({ title: '正在处理，请稍候', icon: 'none' });
      return;
    }

    if (!this.data.currentShift) {
      wx.showToast({ title: '当前没有可操作班次', icon: 'none' });
      return;
    }

    if (this.data.checkDisabled) {
      wx.showToast({
        title: this.data.checkHint || this.data.checkButtonText || '当前班次不可操作',
        icon: 'none',
      });
      return;
    }

    if (this.data.hasCheckedIn) {
      this.onCheckOut();
      return;
    }

    this.onCheckIn();
  },

  getCurrentLocation() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        reject(new Error('定位超时，请检查手机定位、微信定位权限和网络后重试'));
      }, 10000);

      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        highAccuracyExpireTime: 5000,
        success: (location) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          resolve({
            latitude: Number(location.latitude),
            longitude: Number(location.longitude),
          });
        },
        fail: (error) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  },

  requestPrivacyAuthorization() {
    const task = new Promise((resolve, reject) => {
      if (typeof wx.requirePrivacyAuthorize !== 'function') {
        resolve();
        return;
      }

      wx.requirePrivacyAuthorize({
        success: () => resolve(),
        fail: () => reject(new Error('请先同意小程序隐私保护指引后再签到')),
      });
    });

    return withTimeout(task, 6000, '隐私授权无响应，请检查小程序隐私保护指引配置后重试');
  },

  openLocationSetting() {
    return new Promise((resolve, reject) => {
      wx.showModal({
        title: '需要定位权限',
        content: '签到需要获取当前位置，请在设置中开启位置信息权限。',
        confirmText: '去设置',
        success: (modalResult) => {
          if (!modalResult.confirm) {
            reject(new Error('请开启定位权限后再签到'));
            return;
          }

          wx.openSetting({
            success: (settingResult) => {
              if (settingResult.authSetting && settingResult.authSetting['scope.userLocation']) {
                resolve();
                return;
              }

              reject(new Error('未开启定位权限，无法签到'));
            },
            fail: () => reject(new Error('无法打开权限设置，请手动开启微信定位权限')),
          });
        },
        fail: () => reject(new Error('请开启定位权限后再签到')),
      });
    });
  },

  ensureLocationAuthorized() {
    const task = new Promise((resolve, reject) => {
      wx.getSetting({
        success: (setting) => {
          const locationAuth = setting.authSetting
            ? setting.authSetting['scope.userLocation']
            : undefined;

          if (locationAuth === true) {
            resolve();
            return;
          }

          if (locationAuth === false) {
            this.openLocationSetting().then(resolve).catch(reject);
            return;
          }

          wx.authorize({
            scope: 'scope.userLocation',
            success: () => resolve(),
            fail: () => reject(new Error('请允许小程序使用你的位置信息后再签到')),
          });
        },
        fail: () => reject(new Error('无法读取定位授权状态，请稍后重试')),
      });
    });

    return withTimeout(task, 10000, '定位授权无响应，请检查微信定位权限后重试');
  },

  showCheckInError(message) {
    wx.showModal({
      title: '签到失败',
      content: message || '签到失败，请稍后重试',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  async onCheckIn() {
    const userInfo = app.globalData.userInfo;
    const currentShift = this.data.currentShift;

    if (!userInfo || !userInfo._id || !currentShift) {
      wx.showToast({ title: '班次信息异常', icon: 'none' });
      return;
    }

    this.setData({
      loading: true,
      checkHint: '正在请求定位权限，请根据手机提示完成授权。',
    });

    try {
      await this.requestPrivacyAuthorization();
      await this.ensureLocationAuthorized();
      this.setData({ checkHint: '正在获取当前位置，请稍候。' });
      wx.showLoading({ title: '获取定位中', mask: true });
      const location = await this.getCurrentLocation();
      this.setData({ checkHint: '已获取定位，正在提交签到。' });
      wx.showLoading({ title: '正在签到', mask: true });
      const result = await withTimeout(
        callCloudFunction('checkIn', {
          userId: userInfo._id,
          date: formatDate(new Date()),
          scheduleId: currentShift._id,
          latitude: location.latitude,
          longitude: location.longitude,
        }),
        15000,
        '签到服务无响应，请检查网络后重试'
      );

      wx.hideLoading();
      wx.showToast({
        title: result.status || '签到成功',
        icon: 'success',
      });
      await this.loadPageData(false);
    } catch (error) {
      wx.hideLoading();
      const message = String(error && (error.message || error.errMsg) || '');
      const locationPermissionDenied = /auth deny|authorize|permission|scope.userLocation|system permission denied/i.test(message);
      const locationUnavailable = /getLocation|location|定位|timeout|超时/i.test(message);
      const errorText = locationPermissionDenied
        ? '请在手机系统和微信中开启定位权限后再签到'
        : (locationUnavailable ? (message || '无法获取定位，请检查手机定位和网络后重试') : (error.message || '签到失败'));
      this.showCheckInError(errorText);
    } finally {
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

      await this.loadPageData(false);
      wx.hideLoading();
      wx.showToast({
        title: '签退成功',
        icon: 'success',
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || '签退失败',
        icon: 'none',
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  onApproveLeaderApplication(e) {
    const applicationId = String(e.currentTarget.dataset.id || '').trim();
    if (!applicationId) {
      return;
    }

    this.reviewLeaderApplication(applicationId, 'approve');
  },

  onRejectLeaderApplication(e) {
    const applicationId = String(e.currentTarget.dataset.id || '').trim();
    if (!applicationId) {
      return;
    }

    this.reviewLeaderApplication(applicationId, 'reject');
  },

  submitLeaderApplicationReview(requesterId, applicationId, action) {
    return callCloudFunction('reviewLeaderApplication', {
      requesterId,
      applicationId,
      action,
    });
  },

  async onBatchApproveLeaderApplications() {
    const requester = app.globalData.userInfo;
    const applications = this.data.leaderApplications || [];

    if (
      !requester
      || !requester._id
      || applications.length === 0
      || this.data.loading
      || this.data.reviewingApplicationId
      || this.data.batchReviewing
    ) {
      return;
    }

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '确认操作',
        content: `确定要批量通过 ${applications.length} 条班负申请吗？`,
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      });
    });

    if (!confirmed) {
      return;
    }

    this.setData({
      loading: true,
      batchReviewing: true,
      reviewingApplicationId: '',
    });
    wx.showLoading({ title: '批量处理中' });

    let successCount = 0;
    const failedItems = [];

    for (const application of applications) {
      const applicationId = String(application._id || '').trim();
      if (!applicationId) {
        failedItems.push({
          userName: application.userName || '未命名用户',
          message: '申请ID不存在',
        });
        continue;
      }

      this.setData({ reviewingApplicationId: applicationId });

      try {
        await this.submitLeaderApplicationReview(requester._id, applicationId, 'approve');
        successCount += 1;
      } catch (error) {
        failedItems.push({
          userName: application.userName || '未命名用户',
          message: error.message || '审批失败',
        });
      }
    }

    wx.hideLoading();
    this.setData({
      loading: false,
      batchReviewing: false,
      reviewingApplicationId: '',
    });

    if (successCount > 0 || failedItems.length > 0) {
      await this.loadPageData(false);
    }

    if (failedItems.length === 0) {
      wx.showToast({
        title: `已通过 ${successCount} 条`,
        icon: 'success',
      });
      return;
    }

    const failedSummary = failedItems
      .slice(0, 3)
      .map((item) => `${item.userName}：${item.message}`)
      .join('\n');
    const extraCount = Math.max(0, failedItems.length - 3);
    const extraText = extraCount > 0 ? `\n另有 ${extraCount} 条失败，请在列表中继续处理` : '';

    wx.showModal({
      title: '批量通过完成',
      content: `成功 ${successCount} 条，失败 ${failedItems.length} 条。\n${failedSummary}${extraText}`,
      showCancel: false,
    });
  },

  reviewLeaderApplication(applicationId, action) {
    const application = this.data.leaderApplications.find((item) => item._id === applicationId);
    const requester = app.globalData.userInfo;

    if (!application || !requester || !requester._id || this.data.loading || this.data.reviewingApplicationId) {
      return;
    }

    const actionText = action === 'approve' ? '通过' : '驳回';
    wx.showModal({
      title: '确认操作',
      content: `确定要${actionText}${application.userName || '该同学'}对“${application.shiftName || '该班次'}”的班负申请吗？`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        this.setData({
          loading: true,
          reviewingApplicationId: applicationId,
        });
        wx.showLoading({ title: '提交中' });

        try {
          const result = await this.submitLeaderApplicationReview(requester._id, applicationId, action);

          wx.showToast({
            title: result.message || '操作成功',
            icon: 'success',
          });

          await this.loadPageData(false);
        } catch (error) {
          wx.showToast({
            title: error.message || '操作失败',
            icon: 'none',
          });
        } finally {
          wx.hideLoading();
          this.setData({
            loading: false,
            reviewingApplicationId: '',
          });
        }
      },
    });
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
