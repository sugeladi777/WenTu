const app = getApp();

const { USER_ROLE } = require('../../utils/constants');
const { getActiveRole, getRoleText, hasRole } = require('../../utils/role');
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

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatMoney(value) {
  return roundMoney(value).toFixed(2);
}

function formatHours(value) {
  return String(roundMoney(value));
}

function normalizeHourlyRate(value) {
  const rate = Number(String(value || '').trim());
  return Number.isFinite(rate) && rate > 0 ? roundMoney(rate) : 0;
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

function formatRoleText(userInfo) {
  const roles = Array.isArray(userInfo && userInfo.roles) ? userInfo.roles : [];
  if (!roles.length) {
    return getRoleText(userInfo ? userInfo.role : USER_ROLE.MEMBER);
  }

  return roles.map((role) => getRoleText(role)).join(' / ');
}

function getRolePriority(userInfo) {
  if (hasRole(userInfo, USER_ROLE.ADMIN)) {
    return 3;
  }

  if (hasRole(userInfo, USER_ROLE.LEADER)) {
    return 2;
  }

  return 1;
}

Page({
  data: {
    semester: null,
    summary: null,
    userList: [],
    loading: false,
    hourlyRateInput: '',
    createSemesterName: '',
    createSemesterStart: '',
    createSemesterEnd: '',
    totalPendingAmountText: '0.00',
    totalPaidAmountText: '0.00',
    totalUnpaidHoursText: '0',
    totalPaidHoursText: '0',
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

  rebuildDashboardUsers(users = [], summary = this.data.summary) {
    const hourlyRate = normalizeHourlyRate(this.data.hourlyRateInput);
    const userList = users.map((item) => {
      const hasLeaderRole = hasRole(item, USER_ROLE.LEADER);
      const unpaidHours = roundMoney(item.stats && item.stats.unpaidHours);
      const pendingAmount = roundMoney(unpaidHours * hourlyRate);
      const paidAmount = roundMoney(item.stats && item.stats.paidAmount);
      const unpaidShiftCount = Number(item.stats && item.stats.unpaidShiftCount) || 0;

      return {
        ...item,
        roleText: formatRoleText(item),
        roleClass: getRoleClass(item),
        hasLeaderRole,
        canToggleLeader: true,
        toggleRoleText: hasLeaderRole ? '撤销班负身份' : '任命班负身份',
        nextRole: hasLeaderRole ? USER_ROLE.MEMBER : USER_ROLE.LEADER,
        unpaidHoursText: formatHours(unpaidHours),
        paidHoursText: formatHours(item.stats && item.stats.paidHours),
        paidAmountText: formatMoney(paidAmount),
        pendingAmountText: formatMoney(pendingAmount),
        pendingAmount,
        canIssueSalary: Boolean(this.data.semester && hourlyRate > 0 && pendingAmount > 0 && unpaidShiftCount > 0),
        issueSalaryText: pendingAmount > 0 ? `确认发放 ${formatMoney(pendingAmount)} 元` : '暂无待发工资',
      };
    }).sort((left, right) => {
      const priorityDiff = getRolePriority(right) - getRolePriority(left);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return String(left.studentId || '').localeCompare(String(right.studentId || ''));
    });

    const totalPendingAmount = roundMoney((summary && summary.totalUnpaidHours ? summary.totalUnpaidHours : 0) * hourlyRate);

    this.setData({
      userList,
      totalPendingAmountText: formatMoney(totalPendingAmount),
      totalPaidAmountText: formatMoney(summary && summary.totalPaidAmount),
      totalUnpaidHoursText: formatHours(summary && summary.totalUnpaidHours),
      totalPaidHoursText: formatHours(summary && summary.totalPaidHours),
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

      this.dashboardUsers = result.users || [];

      this.setData({
        semester: result.semester || null,
        summary: result.summary || null,
      });

      this.ensureSemesterFormDefaults(result.semester || null);
      this.rebuildDashboardUsers(this.dashboardUsers, result.summary || null);
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

  onHourlyRateInput(e) {
    this.setData({
      hourlyRateInput: String(e.detail.value || '').trim(),
    });

    this.rebuildDashboardUsers(this.dashboardUsers || [], this.data.summary);
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

  onToggleRole(e) {
    const userId = e.currentTarget.dataset.userid;
    const nextRole = Number(e.currentTarget.dataset.role);
    const user = this.data.userList.find((item) => item._id === userId);

    if (!user || !user.canToggleLeader) {
      return;
    }

    const actionText = nextRole === USER_ROLE.LEADER ? '授予班负身份' : '撤销班负身份';

    wx.showModal({
      title: '确认操作',
      content: `确定要为 ${user.name} ${actionText}吗？`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        await this.submitRoleChange(userId, nextRole);
      },
    });
  },

  async submitRoleChange(targetUserId, role) {
    const userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._id) {
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '提交中' });

    try {
      const result = await callCloudFunction('setUserRole', {
        requesterId: userInfo._id,
        targetUserId,
        role,
      });

      wx.showToast({
        title: result.message || '修改成功',
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
      this.setData({ loading: false });
    }
  },

  onIssueSalary(e) {
    const userId = String(e.currentTarget.dataset.userid || '');
    const user = this.data.userList.find((item) => item._id === userId);
    const hourlyRate = normalizeHourlyRate(this.data.hourlyRateInput);
    const semester = this.data.semester;

    if (!user || !semester || !user.canIssueSalary || !hourlyRate) {
      if (!hourlyRate) {
        wx.showToast({ title: '请先输入每工时工资', icon: 'none' });
      }
      return;
    }

    wx.showModal({
      title: '确认发放工资',
      content: `将按 ${formatMoney(hourlyRate)} 元/小时，为 ${user.name} 发放 ${user.unpaidHoursText} 小时工资，共 ${user.pendingAmountText} 元。`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        await this.submitSalary(userId, hourlyRate);
      },
    });
  },

  async submitSalary(targetUserId, hourlyRate) {
    const userInfo = app.globalData.userInfo;
    const semester = this.data.semester;

    if (!userInfo || !userInfo._id || !semester || !semester._id) {
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '发放中' });

    try {
      const result = await callCloudFunction('issueSalary', {
        requesterId: userInfo._id,
        targetUserId,
        semesterId: semester._id,
        hourlyRate,
      });

      wx.showToast({
        title: result.message || '工资已发放',
        icon: 'success',
      });

      await this.loadDashboard();
    } catch (error) {
      wx.showToast({
        title: error.message || '发放失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },
});
