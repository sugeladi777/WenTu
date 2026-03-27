const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function toChinaDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const offsetMinutes = 8 * 60 + date.getTimezoneOffset();
  return new Date(date.getTime() + offsetMinutes * 60 * 1000);
}

function formatChinaDate(input = new Date()) {
  const chinaDate = toChinaDate(input);
  return `${chinaDate.getUTCFullYear()}-${padNumber(chinaDate.getUTCMonth() + 1)}-${padNumber(chinaDate.getUTCDate())}`;
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const date = String(event.date || '').trim() || formatChinaDate();

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const result = await db.collection('schedules')
      .where({ userId, date })
      .orderBy('startTime', 'asc')
      .limit(100)
      .get();

    return {
      success: true,
      schedules: result.data || [],
      count: result.data ? result.data.length : 0,
      date,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
