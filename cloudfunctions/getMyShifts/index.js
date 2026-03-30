const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function loadAllDocuments(collection, filter) {
  const pageSize = 100;
  const documents = [];
  let offset = 0;

  while (true) {
    const result = await collection.where(filter).orderBy('date', 'asc').skip(offset).limit(pageSize).get();
    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
}

exports.main = async (event = {}) => {
  const userId = String(event.userId || '').trim();
  const semesterId = String(event.semesterId || '').trim();
  const startDate = String(event.startDate || '').trim();
  const endDate = String(event.endDate || '').trim();

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const query = { userId };

    if (semesterId) {
      query.semesterId = semesterId;
    }

    if (startDate && endDate) {
      query.date = db.command.gte(startDate).and(db.command.lte(endDate));
    }

    const schedules = await loadAllDocuments(db.collection('schedules'), query);
    schedules.sort((left, right) => {
      if (left.date !== right.date) {
        return String(left.date || '').localeCompare(String(right.date || ''));
      }

      return String(left.startTime || '').localeCompare(String(right.startTime || ''));
    });

    return {
      success: true,
      schedules,
      count: schedules.length,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
