const app = getApp();

const { USER_ROLE } = require('../../utils/constants');
const { formatGrantedRoles, getActiveRole, hasRole } = require('../../utils/role');
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

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
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

function downloadCloudFile(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.downloadFile({
      fileID,
      success: resolve,
      fail: (error) => reject(new Error(error && error.errMsg ? error.errMsg : '文件下载失败')),
    });
  });
}

function openLocalDocument(filePath, fileType = 'xlsx') {
  return new Promise((resolve, reject) => {
    wx.openDocument({
      filePath,
      fileType,
      showMenu: true,
      success: resolve,
      fail: (error) => reject(new Error(error && error.errMsg ? error.errMsg : '文件打开失败')),
    });
  });
}

Page({
  data: {
    semester: null,
    semesterRangeText: '还没有激活学期，可以先创建后再管理导出与排班。',
    summaryCards: [],
    userList: [],
    displayedUserList: [],
    userCount: 0,
    displayedUserCount: 0,
    userSearchKeyword: '',
    loading: false,
    exporting: false,
    batchIssuing: false,
    createSemesterName: '',
    createSemesterStart: '',
    createSemesterEnd: '',
    exportStartDate: '',
    exportStartTime: '00:00',
    exportEndDate: '',
    exportEndTime: '23:59',
    batchSalaryStartDate: '',
    batchSalaryStartTime: '00:00',
    batchSalaryEndDate: '',
    batchSalaryEndTime: '23:59',
    batchHourlyRate: '',
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

  ensureExportFormDefaults(semester) {
    const today = formatDateString(new Date());
    const defaultStartDate = semester && semester.startDate ? semester.startDate : today;
    const defaultEndDate = semester && semester.endDate ? semester.endDate : defaultStartDate;

    this.setData({
      exportStartDate: this.data.exportStartDate || defaultStartDate,
      exportStartTime: this.data.exportStartTime || '00:00',
      exportEndDate: this.data.exportEndDate || defaultEndDate,
      exportEndTime: this.data.exportEndTime || '23:59',
    });
  },

  ensureBatchSalaryFormDefaults(semester) {
    const today = formatDateString(new Date());
    const defaultStartDate = semester && semester.startDate ? semester.startDate : today;
    const defaultEndDate = semester && semester.endDate ? semester.endDate : defaultStartDate;

    this.setData({
      batchSalaryStartDate: this.data.batchSalaryStartDate || defaultStartDate,
      batchSalaryStartTime: this.data.batchSalaryStartTime || '00:00',
      batchSalaryEndDate: this.data.batchSalaryEndDate || defaultEndDate,
      batchSalaryEndTime: this.data.batchSalaryEndTime || '23:59',
    });
  },

  buildSummaryCards(summary = {}) {
    return [
      { label: '总人数', value: Number(summary.totalUserCount || 0) },
      { label: '志愿者', value: Number(summary.memberCount || 0) },
      { label: '班负', value: Number(summary.leaderCount || 0) },
      { label: '管理员', value: Number(summary.adminCount || 0) },
    ];
  },

  buildUserList(users = []) {
    return sortUsers(users).map((item) => {
      const displayName = item.name || '未命名用户';
      const roleBadgeText = getRoleBadgeText(item);
      const grantedRolesText = formatGrantedRoles(item) || roleBadgeText;

      return {
        ...item,
        displayName,
        roleClass: getRoleClass(item),
        roleBadgeText,
        grantedRolesText,
        searchText: normalizeSearchText([
          displayName,
          item.studentId || '',
          roleBadgeText,
          grantedRolesText,
        ].join(' ')),
      };
    });
  },

  filterUserList(users = [], keyword = '') {
    const searchKeyword = normalizeSearchText(keyword);
    if (!searchKeyword) {
      return users.slice();
    }

    return users.filter((item) => item.searchText.includes(searchKeyword));
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
      const summaryCards = this.buildSummaryCards(result.summary || {});
      const userList = this.buildUserList(result.users || []);
      const displayedUserList = this.filterUserList(userList, this.data.userSearchKeyword);

      this.ensureSemesterFormDefaults(semester);
      this.ensureExportFormDefaults(semester);
      this.ensureBatchSalaryFormDefaults(semester);
      this.setData({
        semester,
        semesterRangeText: semester
          ? `${semester.startDate} 至 ${semester.endDate}`
          : '还没有激活学期，可以先创建后再管理导出与排班。',
        summaryCards,
        userList,
        displayedUserList,
        userCount: userList.length,
        displayedUserCount: displayedUserList.length,
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

  onExportStartDateChange(e) {
    this.setData({
      exportStartDate: String(e.detail.value || ''),
    });
  },

  onExportStartTimeChange(e) {
    this.setData({
      exportStartTime: String(e.detail.value || ''),
    });
  },

  onExportEndDateChange(e) {
    this.setData({
      exportEndDate: String(e.detail.value || ''),
    });
  },

  onExportEndTimeChange(e) {
    this.setData({
      exportEndTime: String(e.detail.value || ''),
    });
  },

  onUseSemesterRange() {
    const { semester } = this.data;
    if (!semester) {
      return;
    }

    this.setData({
      exportStartDate: semester.startDate || '',
      exportStartTime: '00:00',
      exportEndDate: semester.endDate || '',
      exportEndTime: '23:59',
    });
  },

  onBatchSalaryStartDateChange(e) {
    this.setData({
      batchSalaryStartDate: String(e.detail.value || ''),
    });
  },

  onBatchSalaryStartTimeChange(e) {
    this.setData({
      batchSalaryStartTime: String(e.detail.value || ''),
    });
  },

  onBatchSalaryEndDateChange(e) {
    this.setData({
      batchSalaryEndDate: String(e.detail.value || ''),
    });
  },

  onBatchSalaryEndTimeChange(e) {
    this.setData({
      batchSalaryEndTime: String(e.detail.value || ''),
    });
  },

  onBatchHourlyRateInput(e) {
    this.setData({
      batchHourlyRate: String(e.detail.value || '').trim(),
    });
  },

  onUseSemesterRangeForSalary() {
    const { semester } = this.data;
    if (!semester) {
      return;
    }

    this.setData({
      batchSalaryStartDate: semester.startDate || '',
      batchSalaryStartTime: '00:00',
      batchSalaryEndDate: semester.endDate || '',
      batchSalaryEndTime: '23:59',
    });
  },

  onUserSearchInput(e) {
    const userSearchKeyword = String(e.detail.value || '');
    const displayedUserList = this.filterUserList(this.data.userList, userSearchKeyword);

    this.setData({
      userSearchKeyword,
      displayedUserList,
      displayedUserCount: displayedUserList.length,
    });
  },

  onClearUserSearch() {
    const displayedUserList = this.filterUserList(this.data.userList, '');
    this.setData({
      userSearchKeyword: '',
      displayedUserList,
      displayedUserCount: displayedUserList.length,
    });
  },

  async onExportWorkHours() {
    const requester = app.globalData.userInfo;
    const {
      exportStartDate,
      exportStartTime,
      exportEndDate,
      exportEndTime,
      loading,
      exporting,
    } = this.data;

    if (loading || exporting) {
      return;
    }

    if (!requester || !requester._id) {
      return;
    }

    if (!exportStartDate || !exportStartTime || !exportEndDate || !exportEndTime) {
      wx.showToast({ title: '请完整选择导出时间段', icon: 'none' });
      return;
    }

    this.setData({ exporting: true });
    wx.showLoading({ title: '导出中' });

    try {
      const result = await callCloudFunction('exportWorkHours', {
        requesterId: requester._id,
        startDate: exportStartDate,
        startTime: exportStartTime,
        endDate: exportEndDate,
        endTime: exportEndTime,
      });

      if (!result.fileID) {
        throw new Error('报表生成成功，但未返回文件');
      }

      const downloadResult = await downloadCloudFile(result.fileID);
      if (!downloadResult.tempFilePath) {
        throw new Error('报表下载失败');
      }

      wx.hideLoading();

      try {
        await openLocalDocument(downloadResult.tempFilePath, 'xlsx');
      } catch (openError) {
        wx.showModal({
          title: '报表已生成',
          content: `${result.fileName || '工时报表.xlsx'} 已下载，但当前设备暂时无法直接打开 xlsx 文件。你可以稍后在微信文件中查看。`,
          showCancel: false,
        });
        return;
      }

      wx.showToast({
        title: result.message || '导出成功',
        icon: 'success',
      });
    } catch (error) {
      wx.showToast({
        title: error.message || '导出失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ exporting: false });
    }
  },

  async onBatchIssueSalary() {
    const requester = app.globalData.userInfo;
    const {
      batchSalaryStartDate,
      batchSalaryStartTime,
      batchSalaryEndDate,
      batchSalaryEndTime,
      batchHourlyRate,
      loading,
      batchIssuing,
    } = this.data;

    if (loading || batchIssuing) {
      return;
    }

    if (!requester || !requester._id) {
      return;
    }

    if (!batchSalaryStartDate || !batchSalaryStartTime || !batchSalaryEndDate || !batchSalaryEndTime) {
      wx.showToast({ title: '请完整选择发薪时间段', icon: 'none' });
      return;
    }

    const hourlyRate = Number(batchHourlyRate);
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      wx.showToast({ title: '请填写正确的每工时工资', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认批量发薪',
      content: `将把 ${batchSalaryStartDate} ${batchSalaryStartTime} 至 ${batchSalaryEndDate} ${batchSalaryEndTime} 内符合条件的班次标记为工资已发放，时薪为 ¥${hourlyRate.toFixed(2)}。`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        this.setData({ batchIssuing: true });
        wx.showLoading({ title: '发薪中' });

        try {
          const result = await callCloudFunction('batchIssueSalary', {
            requesterId: requester._id,
            startDate: batchSalaryStartDate,
            startTime: batchSalaryStartTime,
            endDate: batchSalaryEndDate,
            endTime: batchSalaryEndTime,
            hourlyRate,
          });

          wx.showModal({
            title: '批量发薪完成',
            content: result.message || `已处理 ${result.updatedCount || 0} 个班次。`,
            showCancel: false,
          });

          await this.loadDashboard(false);
        } catch (error) {
          wx.showToast({
            title: error.message || '批量发薪失败',
            icon: 'none',
          });
        } finally {
          wx.hideLoading();
          this.setData({ batchIssuing: false });
        }
      },
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
