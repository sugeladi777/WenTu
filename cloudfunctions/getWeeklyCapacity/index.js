const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function loadAllDocuments(collection, filter, options = {}) {
  const pageSize = options.pageSize || 100;
  const documents = [];
  let offset = 0;

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

exports.main = async (event) => {
  const semesterId = String(event.semesterId || '').trim();

  if (!semesterId) {
    return { success: false, error: '学期ID不能为空' };
  }

  try {
    const templates = await loadAllDocuments(db.collection('shiftTemplates'), { semesterId });
    const selections = await loadAllDocuments(
      db.collection('weeklySelections'),
      { semesterId },
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

    selections.forEach((selection) => {
      if (!selection || !Array.isArray(selection.preferences)) {
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
      capacityList: Object.values(capacityMap),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
