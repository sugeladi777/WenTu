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

async function loadAllDocuments(collection, filter, options = {}) {
  const documents = [];
  let offset = 0;
  const pageSize = options.pageSize || 100;

  while (true) {
    let query = collection.where(filter);

    if (options.field) {
      query = query.field(options.field);
    }

    query = query.skip(offset).limit(pageSize);

    const result = await query.get();
    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
}

async function findSemester(today) {
  const currentResult = await db.collection('semesters')
    .where({
      status: 'active',
      startDate: db.command.lte(today),
      endDate: db.command.gte(today),
    })
    .orderBy('startDate', 'desc')
    .limit(1)
    .get();

  if (currentResult.data && currentResult.data[0]) {
    return currentResult.data[0];
  }

  const upcomingResult = await db.collection('semesters')
    .where({
      status: 'active',
      startDate: db.command.gt(today),
    })
    .orderBy('startDate', 'asc')
    .limit(1)
    .get();

  if (upcomingResult.data && upcomingResult.data[0]) {
    return upcomingResult.data[0];
  }

  return null;
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();

  try {
    const semester = await findSemester(formatChinaDate());
    if (!semester) {
      return { success: false, error: '暂无学期信息' };
    }

    const templates = await loadAllDocuments(db.collection('shiftTemplates'), { semesterId: semester._id });
    templates.sort((left, right) => {
      const timeCompare = String(left.startTime || '').localeCompare(String(right.startTime || ''));
      if (timeCompare !== 0) {
        return timeCompare;
      }

      return String(left.name || '').localeCompare(String(right.name || ''));
    });

    const selections = await loadAllDocuments(
      db.collection('weeklySelections'),
      { semesterId: semester._id },
      {
        field: {
          userId: true,
          preferences: true,
        },
      }
    );

    const capacityMap = {};
    templates.forEach((template) => {
      const maxCapacity = Number(template.maxCapacity) || 0;
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
        capacityMap[`${template._id}::${dayOfWeek}`] = {
          shiftId: template._id,
          dayOfWeek,
          maxCapacity,
          currentCount: 0,
          remaining: maxCapacity,
        };
      }
    });

    let preferences = [];

    selections.forEach((selection) => {
      if (selection.userId === userId) {
        preferences = Array.isArray(selection.preferences) ? selection.preferences : [];
      }

      if (!Array.isArray(selection.preferences)) {
        return;
      }

      selection.preferences.forEach((item) => {
        const key = `${item.shiftId}::${item.dayOfWeek}`;
        if (!capacityMap[key]) {
          return;
        }

        capacityMap[key].currentCount += 1;
        capacityMap[key].remaining = Math.max(
          0,
          capacityMap[key].maxCapacity - capacityMap[key].currentCount
        );
      });
    });

    return {
      success: true,
      semester,
      shiftTemplates: templates,
      capacityList: Object.values(capacityMap),
      preferences,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
