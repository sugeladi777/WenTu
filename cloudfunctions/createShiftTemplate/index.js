const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function normalizeString(value) {
  return String(value || '').trim();
}

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(timeString);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

exports.main = async (event) => {
  const semesterId = normalizeString(event.semesterId);
  const name = normalizeString(event.name);
  const startTime = normalizeString(event.startTime);
  const endTime = normalizeString(event.endTime);
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  const fixedHours = Number(event.fixedHours);
  const maxCapacity = Number(event.maxCapacity);

  if (!semesterId || !name || !startTime || !endTime) {
    return { success: false, error: '参数不完整' };
  }

  if (startMinutes === null || endMinutes === null) {
    return { success: false, error: '时间格式应为 HH:mm' };
  }

  if (startMinutes >= endMinutes) {
    return { success: false, error: '班次结束时间必须晚于开始时间' };
  }

  if (Number.isNaN(maxCapacity) || maxCapacity <= 0) {
    return { success: false, error: '班次容量必须大于 0' };
  }

  try {
    const semester = await db.collection('semesters').doc(semesterId).get();
    if (!semester.data) {
      return { success: false, error: '学期不存在' };
    }

    const result = await db.collection('shiftTemplates').add({
      data: {
        semesterId,
        name,
        startTime,
        endTime,
        fixedHours: Number.isNaN(fixedHours) || fixedHours <= 0
          ? Math.round(((endMinutes - startMinutes) / 60) * 100) / 100
          : fixedHours,
        maxCapacity,
        currentCount: 0,
        createdAt: db.serverDate(),
      },
    });

    return { success: true, templateId: result._id };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
