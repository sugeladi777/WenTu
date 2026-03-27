const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function sanitizePreferences(preferences) {
  const preferenceMap = {};

  if (!Array.isArray(preferences)) {
    return [];
  }

  preferences.forEach((item) => {
    const dayOfWeek = Number(item && item.dayOfWeek);
    const shiftId = String((item && item.shiftId) || '').trim();

    if (!shiftId || Number.isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return;
    }

    preferenceMap[`${shiftId}::${dayOfWeek}`] = { shiftId, dayOfWeek };
  });

  return Object.values(preferenceMap).sort((left, right) => {
    if (left.dayOfWeek !== right.dayOfWeek) {
      return left.dayOfWeek - right.dayOfWeek;
    }

    return left.shiftId.localeCompare(right.shiftId);
  });
}

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

function buildCapacityMap(templates, selections, currentUserId) {
  const capacityMap = {};

  templates.forEach((template) => {
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      capacityMap[`${template._id}::${dayOfWeek}`] = {
        shiftId: template._id,
        dayOfWeek,
        maxCapacity: Number(template.maxCapacity) || 0,
        currentCount: 0,
      };
    }
  });

  selections.forEach((selection) => {
    if (!selection || selection.userId === currentUserId || !Array.isArray(selection.preferences)) {
      return;
    }

    selection.preferences.forEach((item) => {
      const key = `${item.shiftId}::${item.dayOfWeek}`;
      if (capacityMap[key]) {
        capacityMap[key].currentCount += 1;
      }
    });
  });

  return capacityMap;
}

exports.main = async (event) => {
  const semesterId = String(event.semesterId || '').trim();
  const userId = String(event.userId || '').trim();
  const preferences = sanitizePreferences(event.preferences);

  if (!semesterId || !userId) {
    return { success: false, error: '参数错误' };
  }

  try {
    const semesterResult = await db.collection('semesters').doc(semesterId).get();
    const semester = semesterResult.data;

    if (!semester) {
      return { success: false, error: '学期不存在' };
    }

    if (semester.status !== 'active') {
      return { success: false, error: '当前学期不可编辑班次' };
    }

    const templateList = await loadAllDocuments(db.collection('shiftTemplates'), { semesterId });
    const templateMap = {};

    templateList.forEach((template) => {
      templateMap[template._id] = template;
    });

    for (const preference of preferences) {
      if (!templateMap[preference.shiftId]) {
        return { success: false, error: '存在无效的班次模板' };
      }
    }

    const selectionList = await loadAllDocuments(
      db.collection('weeklySelections'),
      { semesterId },
      {
        field: {
          _id: true,
          userId: true,
          preferences: true,
        },
      }
    );

    const capacityMap = buildCapacityMap(templateList, selectionList, userId);

    for (const preference of preferences) {
      const key = `${preference.shiftId}::${preference.dayOfWeek}`;
      const currentCapacity = capacityMap[key];

      if (!currentCapacity) {
        return { success: false, error: '班次容量信息异常' };
      }

      if (currentCapacity.currentCount >= currentCapacity.maxCapacity) {
        return { success: false, error: '所选班次已满员，请刷新后重试' };
      }

      currentCapacity.currentCount += 1;
    }

    const collection = db.collection('weeklySelections');
    const existing = await collection.where({ semesterId, userId }).limit(1).get();

    if (existing.data && existing.data.length > 0) {
      await collection.doc(existing.data[0]._id).update({
        data: {
          preferences,
          updatedAt: db.serverDate(),
        },
      });

      return {
        success: true,
        selectionId: existing.data[0]._id,
        preferences,
      };
    }

    const result = await collection.add({
      data: {
        semesterId,
        userId,
        preferences,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });

    return {
      success: true,
      selectionId: result._id,
      preferences,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
