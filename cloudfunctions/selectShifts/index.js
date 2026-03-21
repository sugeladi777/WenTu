// 云函数入口文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { semesterId, userId, userName, preferences } = event;

  if (!semesterId || !userId || !preferences || !Array.isArray(preferences)) {
    return { success: false, error: '参数错误' };
  }

  try {
    const schedulesCollection = db.collection('schedules');
    const shiftTemplatesCollection = db.collection('shiftTemplates');

    // 获取学期信息
    const semester = await db.collection('semesters').doc(semesterId).get();
    if (!semester.data) {
      return { success: false, error: '学期不存在' };
    }

    if (semester.data.status !== 'active') {
      return { success: false, error: '当前学期未开放选择' };
    }

    // 获取所有班次模板
    const templates = await shiftTemplatesCollection.where({ semesterId }).get();
    const templateMap = {};
    templates.data.forEach(t => {
      templateMap[t._id] = t;
    });

    // 获取所有已选择的班次（用于统计人数）
    const allSchedules = await schedulesCollection
      .where({ semesterId, status: 'normal' })
      .get();

    // 统计每个 shiftId + dayOfWeek 组合的人数（按 userId 去重）
    const userCountMap = {};
    allSchedules.data.forEach(s => {
      const key = `${s.shiftId}_${s.dayOfWeek}`;
      if (!userCountMap[key]) {
        userCountMap[key] = new Set();
      }
      userCountMap[key].add(s.userId);
    });

    // 检查容量限制
    for (const pref of preferences) {
      const template = templateMap[pref.shiftId];
      if (template) {
        const key = `${pref.shiftId}_${pref.dayOfWeek}`;
        const currentCount = userCountMap[key] ? userCountMap[key].size : 0;
        
        if (currentCount >= template.maxCapacity) {
          return { success: false, error: `${template.name}在周${pref.dayOfWeek + 1}已满员` };
        }
      }
    }

    // 删除用户原有的班次
    await schedulesCollection.where({
      semesterId,
      userId,
      status: db.command.neq('swapped')
    }).remove();

    // 生成日期范围内的所有班次
    const startDate = new Date(semester.data.startDate);
    const endDate = new Date(semester.data.endDate);
    const schedules = [];

    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      const ourDayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

      const pref = preferences.find(p => p.dayOfWeek === ourDayOfWeek);
      if (pref) {
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
            status: 'normal',
            createdAt: new Date(),
          });
        }
      }

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

    return { success: true, message: `已生成${schedules.length}条班次记录` };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
