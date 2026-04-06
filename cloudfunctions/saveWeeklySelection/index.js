const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function buildSelectionDocId(semesterId, userId) {
  return `weeklySelection_${String(semesterId || '').trim()}_${String(userId || '').trim()}`;
}

function getTimestamp(value) {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'object') {
    if (typeof value.getTime === 'function') {
      const timestamp = value.getTime();
      return Number.isFinite(timestamp) ? timestamp : 0;
    }

    if (typeof value.seconds === 'number') {
      const milliseconds = typeof value.milliseconds === 'number'
        ? value.milliseconds
        : (typeof value.nanoseconds === 'number' ? Math.floor(value.nanoseconds / 1e6) : 0);
      return value.seconds * 1000 + milliseconds;
    }
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

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

function pickCanonicalSelection(selections = [], preferredId = '') {
  const normalizedPreferredId = String(preferredId || '').trim();

  return selections
    .slice()
    .sort((left, right) => {
      const leftIsPreferred = String(left && left._id || '') === normalizedPreferredId;
      const rightIsPreferred = String(right && right._id || '') === normalizedPreferredId;
      if (leftIsPreferred !== rightIsPreferred) {
        return leftIsPreferred ? -1 : 1;
      }

      const timestampDiff = getTimestamp(right && (right.updatedAt || right.createdAt))
        - getTimestamp(left && (left.updatedAt || left.createdAt));
      if (timestampDiff !== 0) {
        return timestampDiff;
      }

      return String(right && right._id || '').localeCompare(String(left && left._id || ''));
    })[0] || null;
}

function normalizeSelectionsByUser(selections = []) {
  const groupedSelections = {};

  selections.forEach((item) => {
    const userId = String(item && item.userId || '').trim();
    if (!userId) {
      return;
    }

    if (!groupedSelections[userId]) {
      groupedSelections[userId] = [];
    }

    groupedSelections[userId].push(item);
  });

  return Object.keys(groupedSelections).map((userId) => {
    return pickCanonicalSelection(groupedSelections[userId]);
  }).filter(Boolean);
}

function buildCapacityMap(templates, selections) {
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
    if (!selection || !Array.isArray(selection.preferences)) {
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
  const selectionDocId = buildSelectionDocId(semesterId, userId);

  if (!semesterId || !userId) {
    return { success: false, error: '参数错误' };
  }

  try {
    const result = await db.runTransaction(async (transaction) => {
      const semesterResult = await transaction.collection('semesters').doc(semesterId).get();
      const semester = semesterResult.data;

      if (!semester) {
        throw new Error('学期不存在');
      }

      if (semester.status !== 'active') {
        throw new Error('当前学期不可编辑班次');
      }

      const templateList = await loadAllDocuments(transaction.collection('shiftTemplates'), { semesterId });
      const templateMap = {};

      templateList.forEach((template) => {
        templateMap[template._id] = template;
      });

      for (const preference of preferences) {
        if (!templateMap[preference.shiftId]) {
          throw new Error('存在无效的班次模板');
        }
      }

      const selectionList = await loadAllDocuments(
        transaction.collection('weeklySelections'),
        { semesterId },
        {
          field: {
            _id: true,
            userId: true,
            preferences: true,
            createdAt: true,
            updatedAt: true,
          },
        }
      );

      const currentUserSelections = selectionList.filter((item) => String(item.userId || '').trim() === userId);
      const currentCanonicalSelection = pickCanonicalSelection(currentUserSelections, selectionDocId);
      const normalizedSelections = normalizeSelectionsByUser(selectionList)
        .filter((item) => String(item.userId || '').trim() !== userId);
      normalizedSelections.push({
        _id: selectionDocId,
        userId,
        preferences,
        createdAt: currentCanonicalSelection ? currentCanonicalSelection.createdAt : null,
        updatedAt: currentCanonicalSelection ? currentCanonicalSelection.updatedAt : null,
      });

      const capacityMap = buildCapacityMap(templateList, normalizedSelections);

      for (const preference of preferences) {
        const key = `${preference.shiftId}::${preference.dayOfWeek}`;
        const currentCapacity = capacityMap[key];

        if (!currentCapacity) {
          throw new Error('班次容量信息异常');
        }

        if (currentCapacity.currentCount > currentCapacity.maxCapacity) {
          throw new Error('所选班次已满员，请刷新后重试');
        }
      }

      await transaction.collection('weeklySelections').doc(selectionDocId).set({
        data: {
          semesterId,
          userId,
          preferences,
          createdAt: currentCanonicalSelection && currentCanonicalSelection.createdAt
            ? currentCanonicalSelection.createdAt
            : db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });

      const duplicateSelectionIds = currentUserSelections
        .map((item) => String(item._id || '').trim())
        .filter((item) => item && item !== selectionDocId);

      for (const duplicateSelectionId of duplicateSelectionIds) {
        await transaction.collection('weeklySelections').doc(duplicateSelectionId).remove();
      }

      return {
        selectionId: selectionDocId,
        preferences,
      };
    });

    return {
      success: true,
      selectionId: result.selectionId,
      preferences: result.preferences,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
