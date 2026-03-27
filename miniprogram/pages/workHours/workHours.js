const app = getApp();

const { VIEW_MODE } = require('../../utils/constants');
const { callCloudFunction } = require('../../utils/cloud');
const { getDateRange, parseDateString, parseDateTime } = require('../../utils/date');
const { decorateSchedule } = require('../../utils/shift');

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const VIEW_MODE_LABELS = {
  [VIEW_MODE.DAY]: '日',
  [VIEW_MODE.WEEK]: '周',
  [VIEW_MODE.MONTH]: '月',
  [VIEW_MODE.SEMESTER]: '本学期',
};

function getStatusTone(statusClass) {
  if (statusClass === 'text-success' || statusClass === 'text-primary') {
    return 'tone-success';
  }

  if (statusClass === 'text-warning') {
    return 'tone-warning';
  }

  if (statusClass === 'text-danger') {
    return 'tone-danger';
  }

  return 'tone-muted';
}

function getDateMeta(dateString) {
  const date = parseDateString(dateString);
  if (!date) {
    return {
      dayText: dateString || '--',
      weekText: '',
    };
  }

  return {
    dayText: `${date.getMonth() + 1}/${date.getDate()}`,
    weekText: WEEKDAY_LABELS[date.getDay()],
  };
}

function getRecordSortTimestamp(record) {
  if (!record) {
    return Number.POSITIVE_INFINITY;
  }

  const dateString = String(record.date || '').trim();
  const timeString = String(record.startTime || record.endTime || '00:00').trim();
  const exactTime = parseDateTime(`${dateString} ${timeString}`);

  if (exactTime) {
    return exactTime.getTime();
  }

  const dateOnly = parseDateString(dateString);
  return dateOnly ? dateOnly.getTime() : Number.POSITIVE_INFINITY;
}

function sortByClosestToNow(list) {
  const now = Date.now();

  return list.slice().sort((left, right) => {
    const leftTime = getRecordSortTimestamp(left);
    const rightTime = getRecordSortTimestamp(right);
    const leftDistance = Math.abs(leftTime - now);
    const rightDistance = Math.abs(rightTime - now);

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    return rightTime - leftTime;
  });
}

function roundNumber(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatMoney(value) {
  return roundNumber(value).toFixed(2);
}

function buildSummary(summary) {
  return {
    totalHours: roundNumber(summary && summary.totalHours),
    totalPaidAmount: formatMoney(summary && summary.totalPaidAmount),
    validCount: Number((summary && summary.validCount) || 0),
    paidCount: Number((summary && summary.paidCount) || 0),
    unpaidCount: Number((summary && summary.unpaidCount) || 0),
  };
}

function buildSummaryMeta(viewMode, semester, rangeLabel) {
  const isSemesterView = viewMode === VIEW_MODE.SEMESTER;

  return {
    currentLabel: isSemesterView ? ((semester && semester.name) || '本学期') : rangeLabel,
    summaryKicker: isSemesterView ? '本学期累计' : '当前范围',
    summaryBadge: VIEW_MODE_LABELS[viewMode] || '',
  };
}

Page({
  data: {
    currentLabel: '',
    summaryKicker: '当前范围',
    summaryBadge: VIEW_MODE_LABELS[VIEW_MODE.MONTH],
    viewMode: VIEW_MODE.MONTH,
    workHoursList: [],
    semester: null,
    loading: false,
    summary: buildSummary(),
  },

  onLoad() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }

    this._skipNextOnShowRefresh = true;
    this.loadWorkHours();
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

    this.loadWorkHours();
  },

  onViewModeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.viewMode) {
      return;
    }

    this.setData({ viewMode: mode });
    this.loadWorkHours();
  },

  async loadWorkHours() {
    if (this.loadWorkHoursPromise) {
      return this.loadWorkHoursPromise;
    }

    const task = (async () => {
      const userInfo = app.globalData.userInfo;
      if (!userInfo || !userInfo._id) {
        return;
      }

      const { viewMode } = this.data;
      const range = getDateRange(viewMode, new Date());
      const initialSummaryMeta = buildSummaryMeta(viewMode, null, range.label);

      this.setData({
        currentLabel: initialSummaryMeta.currentLabel,
        summaryKicker: initialSummaryMeta.summaryKicker,
        summaryBadge: initialSummaryMeta.summaryBadge,
        loading: true,
      });

      try {
        let semester = null;

        try {
          const semesterResult = await callCloudFunction('getCurrentSemester');
          semester = semesterResult.semester || null;
        } catch (error) {
          console.warn('获取学期信息失败:', error);
        }

        if (viewMode === VIEW_MODE.SEMESTER && !semester) {
          const summaryMeta = buildSummaryMeta(viewMode, null, range.label);

          this.setData({
            semester: null,
            workHoursList: [],
            currentLabel: summaryMeta.currentLabel,
            summaryKicker: summaryMeta.summaryKicker,
            summaryBadge: summaryMeta.summaryBadge,
            summary: buildSummary(),
          });
          return;
        }

        const result = await callCloudFunction('getWorkHours', {
          userId: userInfo._id,
          startDate: range.startDate,
          endDate: range.endDate,
          semesterId: semester ? semester._id : '',
        });

        const workHoursList = sortByClosestToNow((result.list || []).map((item) => {
          const decorated = decorateSchedule(item);
          const dateMeta = getDateMeta(item.date);
          const hours = roundNumber(item.hours || item.actualHours || 0);
          const salaryAmount = roundNumber(item.salaryAmount || 0);

          return {
            ...decorated,
            ...item,
            ...dateMeta,
            statusText: decorated.attendanceText,
            statusClass: decorated.attendanceClass,
            statusTone: getStatusTone(decorated.attendanceClass),
            hours,
            paidText: item.salaryPaid
              ? `已发 ￥${formatMoney(salaryAmount)}`
              : (item.isValid ? '待发工资' : '不计工资'),
            timeRange: `${item.startTime || '--'} - ${item.endTime || '--'}`,
          };
        }));

        const summaryMeta = buildSummaryMeta(viewMode, semester, range.label);

        this.setData({
          semester,
          workHoursList,
          currentLabel: summaryMeta.currentLabel,
          summaryKicker: summaryMeta.summaryKicker,
          summaryBadge: summaryMeta.summaryBadge,
          summary: buildSummary(result.rangeSummary || result),
        });
      } catch (error) {
        wx.showToast({
          title: error.message || '加载失败',
          icon: 'none',
        });
      } finally {
        this.setData({ loading: false });
      }
    })();

    this.loadWorkHoursPromise = task;

    try {
      return await task;
    } finally {
      if (this.loadWorkHoursPromise === task) {
        this.loadWorkHoursPromise = null;
      }
    }
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id;
    const record = this.data.workHoursList.find((item) => item._id === id);

    if (!record) {
      return;
    }

    const shiftData = encodeURIComponent(JSON.stringify(record));
    wx.navigateTo({
      url: `/pages/shiftDetail/shiftDetail?shiftData=${shiftData}`,
    });
  },
});
