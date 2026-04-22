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

function formatChinaDateTime(input = new Date()) {
  const chinaDate = toChinaDate(input);
  return `${chinaDate.getUTCFullYear()}-${padNumber(chinaDate.getUTCMonth() + 1)}-${padNumber(chinaDate.getUTCDate())} ${padNumber(chinaDate.getUTCHours())}:${padNumber(chinaDate.getUTCMinutes())}`;
}

function resolveSelectionEditPermission(semester) {
  if (!semester) {
    return {
      canEditSelection: false,
      selectionEditWindowHint: '暂无可编辑学期',
    };
  }

  const windowEnabled = Boolean(semester.selectionEditWindowEnabled);
  const windowStart = String(semester.selectionEditStartAt || '').trim();
  const windowEnd = String(semester.selectionEditEndAt || '').trim();

  if (!windowEnabled) {
    return {
      canEditSelection: false,
      selectionEditWindowHint: '当前未开放固定排班修改',
    };
  }

  if (!windowStart || !windowEnd) {
    return {
      canEditSelection: false,
      selectionEditWindowHint: '调班时间配置不完整，请联系管理员',
    };
  }

  const nowDateTime = formatChinaDateTime();
  if (nowDateTime < windowStart) {
    return {
      canEditSelection: false,
      selectionEditWindowHint: `开放时间：${windowStart} 至 ${windowEnd}`,
    };
  }

  if (nowDateTime > windowEnd) {
    return {
      canEditSelection: false,
      selectionEditWindowHint: `本次开放已结束：${windowStart} 至 ${windowEnd}`,
    };
  }

  return {
    canEditSelection: true,
    selectionEditWindowHint: `当前开放中：${windowStart} 至 ${windowEnd}`,
  };
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
  const semesterResult = await db.collection('semesters')
    .where({ status: 'active' })
    .orderBy('startDate', 'desc')
    .limit(100)
    .get();
  const semesterList = semesterResult.data || [];

  const currentSemester = semesterList.find((item) => {
    const startDate = String(item.startDate || '').trim();
    const endDate = String(item.endDate || '').trim();
    return startDate && endDate && startDate <= today && endDate >= today;
  });

  if (currentSemester) {
    return { semester: currentSemester, semesterList };
  }

  const upcomingList = semesterList
    .filter((item) => String(item.startDate || '').trim() > today)
    .sort((left, right) => String(left.startDate || '').localeCompare(String(right.startDate || '')));

  if (upcomingList.length > 0) {
    return { semester: upcomingList[0], semesterList };
  }

  return {
    semester: semesterList[0] || null,
    semesterList,
  };
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const preferredSemesterId = String(event.semesterId || '').trim();

  try {
    if (!userId) {
      return { success: false, error: '用户ID不能为空' };
    }

    const userResult = await db.collection('users').doc(userId).get();
    const user = userResult.data || null;
    if (!user) {
      return { success: false, error: '用户不存在' };
    }

    const { semesterList, semester: defaultSemester } = await findSemester(formatChinaDate());
    const semester = preferredSemesterId
      ? (semesterList.find((item) => String(item._id || '') === preferredSemesterId) || defaultSemester)
      : defaultSemester;
    if (!semester) {
      return {
        success: true,
        semester: null,
        semesterList,
        shiftTemplates: [],
        capacityList: [],
        preferences: [],
        canEditSelection: false,
        selectionEditWindowHint: '暂无可编辑学期',
      };
    }

    const templates = await loadAllDocuments(db.collection('shiftTemplates'), { semesterId: semester._id });
    templates.sort((left, right) => {
      const timeCompare = String(left.startTime || '').localeCompare(String(right.startTime || ''));
      if (timeCompare !== 0) {
        return timeCompare;
      }

      return String(left.name || '').localeCompare(String(right.name || ''));
    });

    const selectionDocuments = await loadAllDocuments(
      db.collection('weeklySelections'),
      { semesterId: semester._id },
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
    const selections = normalizeSelectionsByUser(selectionDocuments, semester._id);

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

    const selectionEditPermission = resolveSelectionEditPermission(semester);

    return {
      success: true,
      semester,
      semesterList,
      shiftTemplates: templates,
      capacityList: Object.values(capacityMap),
      preferences,
      canEditSelection: selectionEditPermission.canEditSelection,
      selectionEditWindowHint: selectionEditPermission.selectionEditWindowHint,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
