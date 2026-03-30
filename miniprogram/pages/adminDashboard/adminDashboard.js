const app = getApp();

const { USER_ROLE } = require('../../utils/constants');
const { getActiveRole, hasRole } = require('../../utils/role');
const { callCloudFunction } = require('../../utils/cloud');

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function parseDateString(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateString(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function addDays(dateString, offsetDays) {
  const date = parseDateString(dateString);
  if (!date) {
    return '';
  }

  date.setDate(date.getDate() + offsetDays);
  return formatDateString(date);
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

const WEEKDAY_TEXTS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function sortUsers(users = []) {
  return users.slice().sort((left, right) => {
    const leftStudentId = String(left.studentId || '');
    const rightStudentId = String(right.studentId || '');
    if (leftStudentId !== rightStudentId) {
      return leftStudentId.localeCompare(rightStudentId);
    }

    return String(left.name || '').localeCompare(String(right.name || ''));
  });
}

Page({
  data: {
    semester: null,
    userList: [],
    userCount: 0,
    leaderApplications: [],
    loading: false,
    reviewingApplicationId: '',
    createSemesterName: '',
    createSemesterStart: '',
    createSemesterEnd: '',
  },

  async onLoad() {
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

    const userInfo = await app.refreshUserInfo();
    if (!userInfo || getActiveRole(userInfo) !== USER_ROLE.ADMIN) {
      wx.showToast({ title: '请以管理员身份进入', icon: 'none' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/profile/profile' });
      }, 500);
      return;
    }

    await this.loadDashboard(showLoading);
  },

  ensureSemesterFormDefaults(semester) {
    if (this.data.createSemesterStart && this.data.createSemesterEnd) {
      return;
    }

    const startDate = semester && semester.endDate
      ? addDays(semester.endDate, 1)
      : formatDateString(new Date());
    const endDate = addDays(startDate, 120) || startDate;

    this.setData({
      createSemesterStart: this.data.createSemesterStart || startDate,
      createSemesterEnd: this.data.createSemesterEnd || endDate,
    });
  },

  buildUserList(users = []) {
    return sortUsers(users).map((item) => ({
      ...item,
      displayName: item.name || '未命名用户',
      roleClass: getRoleClass(item),
      roleBadgeText: getRoleBadgeText(item),
    }));
  },

  buildLeaderApplications(applications = []) {
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
  },

  async loadDashboard(showLoading = false) {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id) {
      return;
    }

    this.setData({ loading: true });
    if (showLoading) {
      wx.showLoading({ title: '加载中' });
    }

    try {
      const result = await callCloudFunction('getAdminDashboard', {
        requesterId: userInfo._id,
      });

      const semester = result.semester || null;
      const userList = this.buildUserList(result.users || []);
      const leaderApplications = this.buildLeaderApplications(result.leaderApplications || []);

      this.ensureSemesterFormDefaults(semester);
      this.setData({
        semester,
        userList,
        userCount: userList.length,
        leaderApplications,
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

  onSemesterNameInput(e) {
    this.setData({
      createSemesterName: String(e.detail.value || '').trim(),
    });
  },

  onSemesterStartChange(e) {
    this.setData({
      createSemesterStart: String(e.detail.value || ''),
    });
  },

  onSemesterEndChange(e) {
    this.setData({
      createSemesterEnd: String(e.detail.value || ''),
    });
  },

  async onCreateSemester() {
    const requester = app.globalData.userInfo;
    const { createSemesterName, createSemesterStart, createSemesterEnd, loading } = this.data;

    if (loading) {
      return;
    }

    if (!requester || !requester._id) {
      return;
    }

    if (!createSemesterName || !createSemesterStart || !createSemesterEnd) {
      wx.showToast({ title: '请填写完整的学期信息', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认创建学期',
      content: `将创建“${createSemesterName}”，时间为 ${createSemesterStart} 至 ${createSemesterEnd}。`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        this.setData({ loading: true });
        wx.showLoading({ title: '创建中' });

        try {
          const result = await callCloudFunction('createSemester', {
            requesterId: requester._id,
            name: createSemesterName,
            startDate: createSemesterStart,
            endDate: createSemesterEnd,
          });

          wx.showToast({
            title: result.message || '学期创建成功',
            icon: 'success',
          });

          this.setData({
            createSemesterName: '',
            createSemesterStart: '',
            createSemesterEnd: '',
          });

          await this.loadDashboard();
        } catch (error) {
          wx.showToast({
            title: error.message || '创建失败',
            icon: 'none',
          });
        } finally {
          wx.hideLoading();
          this.setData({ loading: false });
        }
      },
    });
  },

  onOpenUserDetail(e) {
    const userId = String(e.currentTarget.dataset.userid || '').trim();
    if (!userId) {
      return;
    }

    wx.navigateTo({
      url: `/pages/adminVolunteerDetail/adminVolunteerDetail?userId=${userId}`,
    });
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
          const result = await callCloudFunction('reviewLeaderApplication', {
            requesterId: requester._id,
            applicationId,
            action,
          });

          wx.showToast({
            title: result.message || '操作成功',
            icon: 'success',
          });

          await this.loadDashboard();
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
});
