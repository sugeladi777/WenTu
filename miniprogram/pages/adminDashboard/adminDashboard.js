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

function sortUsers(users = []) {
  return users.slice().sort((left, right) => {
    const leftStudentId = String(left.studentId || '');
    const rightStudentId = String(right.studentId || '');
    if (leftStudentId !== rightStudentId) {
      return leftStudentId.localeCompare(rightStudentId);
    }

    return String(left.name || left.nickname || '').localeCompare(String(right.name || right.nickname || ''));
  });
}

Page({
  data: {
    semester: null,
    userList: [],
    userCount: 0,
    loading: false,
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
      displayName: item.name || item.nickname || '未命名用户',
      roleClass: getRoleClass(item),
      roleBadgeText: getRoleBadgeText(item),
    }));
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

      this.ensureSemesterFormDefaults(semester);
      this.setData({
        semester,
        userList,
        userCount: userList.length,
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
});
