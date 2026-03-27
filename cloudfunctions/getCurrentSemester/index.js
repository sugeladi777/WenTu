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

async function findCurrentSemester(today) {
  const result = await db.collection('semesters')
    .where({
      status: 'active',
      startDate: db.command.lte(today),
      endDate: db.command.gte(today),
    })
    .orderBy('startDate', 'desc')
    .limit(1)
    .get();

  return result.data && result.data[0] ? result.data[0] : null;
}

async function findUpcomingSemester(today) {
  const result = await db.collection('semesters')
    .where({
      status: 'active',
      startDate: db.command.gt(today),
    })
    .orderBy('startDate', 'asc')
    .limit(1)
    .get();

  return result.data && result.data[0] ? result.data[0] : null;
}

async function findLatestSemester() {
  const result = await db.collection('semesters')
    .where({ status: 'active' })
    .orderBy('endDate', 'desc')
    .limit(1)
    .get();

  return result.data && result.data[0] ? result.data[0] : null;
}

exports.main = async () => {
  try {
    const today = formatChinaDate();

    const currentSemester = await findCurrentSemester(today);
    if (currentSemester) {
      return { success: true, semester: currentSemester };
    }

    const upcomingSemester = await findUpcomingSemester(today);
    if (upcomingSemester) {
      return { success: true, semester: upcomingSemester };
    }

    const latestSemester = await findLatestSemester();
    if (latestSemester) {
      return { success: true, semester: latestSemester };
    }

    return { success: false, error: '暂无学期信息' };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
