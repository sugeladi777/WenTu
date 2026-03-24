// pages/myShift/myShift.js
const app = getApp();

Page({
  data: {
    semester: null,
    shiftList: [],
    weeklyShifts: [],
    currentWeekIndex: 0,
    weekDayNames: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    loading: false,
  },

  onLoad() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadMyShifts();
  },

  onShow() {
    if (!app.checkLogin()) {
      app.goToLogin();
      return;
    }
    this.loadMyShifts();
  },

  async loadMyShifts() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo?._id) {
      wx.showToast({ title: '用户信息缺失', icon: 'none' });
      return;
    }

    this.setData({ loading: true });

    try {
      const semesterRes = await wx.cloud.callFunction({
        name: 'getCurrentSemester',
      });

      if (semesterRes.result?.success) {
        this.setData({ semester: semesterRes.result.semester });
      }

      const shiftRes = await wx.cloud.callFunction({
        name: 'getMyShifts',
        data: { userId: userInfo._id },
      });

      // 兼容新的返回格式（schedules）
      const shifts = shiftRes.result?.schedules || shiftRes.result?.shifts || [];
      
      if (shiftRes.result?.success && shifts.length > 0) {
        const weeklyData = this.buildWeeklyCalendarData(shifts);
        // 找到当前周
        const today = new Date().toISOString().split('T')[0];
        let currentIndex = 0;
        weeklyData.forEach((week, i) => {
          if (today >= week.weekStart) {
            currentIndex = i;
          }
        });
        this.setData({ 
          shiftList: shifts,
          weeklyShifts: weeklyData,
          currentWeekIndex: currentIndex,
        });
      } else {
        this.setData({ shiftList: [], weeklyShifts: [], currentWeekIndex: 0 });
      }
    } catch (err) {
      console.error('加载班次失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  buildWeeklyCalendarData(shifts) {
    const weekMap = {};
    
    shifts.forEach(shift => {
      const dateStr = shift.date;
      const date = new Date(dateStr);
      const dayOfWeekRaw = date.getDay();
      const dayIndex = dayOfWeekRaw === 0 ? 6 : dayOfWeekRaw - 1;
      
      const mondayOffset = dayOfWeekRaw === 0 ? -6 : 1 - dayOfWeekRaw;
      const monday = new Date(date);
      monday.setDate(date.getDate() + mondayOffset);
      const weekKey = monday.toISOString().split('T')[0];
      
      if (!weekMap[weekKey]) {
        const dates = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          dates.push(`${d.getMonth() + 1}/${d.getDate()}`);
        }
        
        weekMap[weekKey] = {
          weekStart: weekKey,
          dates: dates,
          days: [[], [], [], [], [], [], []],
        };
      }
      
      weekMap[weekKey].days[dayIndex].push(shift);
    });
    
    return Object.keys(weekMap).sort().map(key => weekMap[key]);
  },

  onWeekChange(e) {
    this.setData({ currentWeekIndex: e.detail.current });
  },

  onEditShiftTap() {
    wx.navigateTo({ url: '/pages/selectSchedule/selectSchedule' });
  },

  onShiftTap(e) {
    const { id } = e.currentTarget.dataset;
    const shift = this.data.shiftList.find(s => s._id === id);
    if (shift) {
      const weekDayName = this.data.weekDayNames[shift.dayOfWeek] || '未知';
      let statusText = '正常';
      if (shift.shiftType === 1) statusText = '请假';
      else if (shift.shiftType === 2) statusText = '替班';
      else if (shift.shiftType === 3) statusText = '蹭班';
      
      let content = `${shift.date} ${weekDayName}\n班次：${shift.shiftName}\n时间：${shift.startTime} - ${shift.endTime}\n状态：${statusText}`;
      
      if (shift.checkInTime) {
        content += `\n签到：${this.formatTime(shift.checkInTime)}`;
      }
      if (shift.checkOutTime) {
        content += `\n签退：${this.formatTime(shift.checkOutTime)}`;
      }
      
      wx.showModal({
        title: '班次详情',
        content: content,
        showCancel: false,
      });
    }
  },

  formatTime(date) {
    if (!date) return '--';
    const d = new Date(date);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  },
});
