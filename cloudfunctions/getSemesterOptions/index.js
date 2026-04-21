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

function pickSemester(semesterList = [], preferredSemesterId = '', today = formatChinaDate()) {
  const normalizedPreferredSemesterId = String(preferredSemesterId || '').trim();
  if (!semesterList.length) {
    return null;
  }

  if (normalizedPreferredSemesterId) {
    const preferredSemester = semesterList.find((item) => String(item._id || '').trim() === normalizedPreferredSemesterId);
    if (preferredSemester) {
      return preferredSemester;
    }
  }

  const currentSemester = semesterList.find((item) => {
    const startDate = String(item.startDate || '').trim();
    const endDate = String(item.endDate || '').trim();
    return startDate && endDate && startDate <= today && endDate >= today;
  });

  if (currentSemester) {
    return currentSemester;
  }

  const upcomingSemesters = semesterList
    .filter((item) => String(item.startDate || '').trim() > today)
    .sort((left, right) => String(left.startDate || '').localeCompare(String(right.startDate || '')));
  if (upcomingSemesters.length > 0) {
    return upcomingSemesters[0];
  }

  return semesterList
    .slice()
    .sort((left, right) => String(right.endDate || '').localeCompare(String(left.endDate || '')))[0];
}

exports.main = async (event = {}) => {
  const preferredSemesterId = String(event.semesterId || '').trim();

  try {
    const semesterResult = await db.collection('semesters')
      .where({ status: 'active' })
      .orderBy('startDate', 'desc')
      .limit(100)
      .get();
    const semesterList = semesterResult.data || [];
    const semester = pickSemester(semesterList, preferredSemesterId, formatChinaDate());

    return {
      success: true,
      semester,
      semesterList,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};
