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

function normalizeSelectionsByUser(selections = [], semesterId = '') {
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
    return pickCanonicalSelection(groupedSelections[userId], buildSelectionDocId(semesterId, userId));
  }).filter(Boolean);
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

exports.main = async (event) => {
  const semesterId = String(event.semesterId || '').trim();

  if (!semesterId) {
    return { success: false, error: '学期ID不能为空' };
  }

  try {
    const templates = await loadAllDocuments(db.collection('shiftTemplates'), { semesterId });
    const selectionDocuments = await loadAllDocuments(
      db.collection('weeklySelections'),
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
    const selections = normalizeSelectionsByUser(selectionDocuments, semesterId);

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
