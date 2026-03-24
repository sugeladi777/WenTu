/**
 * 生成班次
 * 根据 weeklySelections 生成具体的 schedules 记录
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 班次类型常量
const SHIFT_TYPE_NORMAL = 0;   // 正常
const SHIFT_TYPE_LEAVE = 1;    // 请假
const SHIFT_TYPE_SWAP = 2;    // 替班
const SHIFT_TYPE_BORROW = 3;  // 蹭班

exports.main = async (event, context) => {
  const { semesterId, userId, userName } = event;

  if (!semesterId || !userId) {
    return { success: false, error: '参数错误' };
  }

  try {
    const schedulesCollection = db.collection('schedules');
    const shiftTemplatesCollection = db.collection('shiftTemplates');
    const weeklySelectionsCollection = db.collection('weeklySelections');

    // 获取学期信息
    const semester = await db.collection('semesters').doc(semesterId).get();
    if (!semester.data) {
      return { success: false, error: '学期不存在' };
    }

    if (semester.data.status !== 'active') {
      return { success: false, error: '当前学期未开放' };
    }

    // 获取用户的周选择
    const selection = await weeklySelectionsCollection
      .where({ semesterId, userId })
      .get();

    if (!selection.data || selection.data.length === 0 || !selection.data[0].preferences) {
      return { success: false, error: '未找到班次选择' };
    }

    const preferences = selection.data[0].preferences;

    // 获取所有班次模板
    const templates = await shiftTemplatesCollection.where({ semesterId }).get();
    const templateMap = {};
    templates.data.forEach(t => {
      templateMap[t._id] = t;
    });

    // 确定班次生成开始日期
    const semesterStartDate = new Date(semester.data.startDate);
    const semesterEndDate = new Date(semester.data.endDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    // 当前时间晚于学期开始，则从今天开始
    let startDate = now > semesterStartDate ? now : semesterStartDate;

    // 删除用户原有的班次（保留调班的班次类型为替班的）
    await schedulesCollection.where({
      semesterId,
      userId,
      shiftType: db.command.neq(SHIFT_TYPE_SWAP)
    }).remove();

    // 生成班次
    const schedules = [];
    let currentDate = new Date(startDate);
    
    while (currentDate <= semesterEndDate) {
      const dayOfWeek = currentDate.getDay();
      const ourDayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

      // 获取该天的所有班次选择
      const dayPrefs = preferences.filter(p => p.dayOfWeek === ourDayOfWeek);
      
      dayPrefs.forEach(pref => {
        const template = templateMap[pref.shiftId];
        if (template) {
          const dateStr = currentDate.toISOString().split('T')[0];
          schedules.push({
            semesterId,
            userId,
            userName: userName || '',
            date: dateStr,
            dayOfWeek: ourDayOfWeek,
            shiftId: pref.shiftId,
            shiftName: template.name,
            startTime: template.startTime,
            endTime: template.endTime,
            fixedHours: template.fixedHours || 2,
            // 新增字段
            shiftType: SHIFT_TYPE_NORMAL,  // 默认为正常
            checkInTime: null,
            checkOutTime: null,
            attendanceStatus: null,
            overtimeHours: 0,
            overtimeApproved: false,
            leaveReason: '',
            leaveStatus: null,
            leaveApprovedBy: null,
            leaveApprovedAt: null,
            originalUserId: null,
            salaryPaid: false,
            salaryWeek: null,
            salaryAmount: null,
            salaryPaidAt: null,
            salaryPaidBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // 批量插入
    if (schedules.length > 0) {
      const BATCH_SIZE = 10;
      for (let i = 0; i < schedules.length; i += BATCH_SIZE) {
        const batch = schedules.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(s => schedulesCollection.add({ data: s })));
      }
    }

    return { success: true, message: `已生成${schedules.length}条班次` };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
