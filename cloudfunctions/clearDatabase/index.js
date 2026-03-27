/**
 * 清空数据库
 * 保留 semesters、shiftTemplates，其余集合全部清空
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const PROTECTED_COLLECTIONS = new Set(['semesters', 'shiftTemplates']);
const FALLBACK_COLLECTIONS = [
  'users',
  'semesters',
  'shiftTemplates',
  'schedules',
  'weeklySelections',
  'shiftRequests',
  'rewards',
];
const BATCH_SIZE = 100;

async function getCollectionNames() {
  if (typeof db.listCollections === 'function') {
    const result = await db.listCollections();
    const collections = Array.isArray(result.collections) ? result.collections : [];

    return collections
      .map((item) => String(item.name || '').trim())
      .filter(Boolean);
  }

  return FALLBACK_COLLECTIONS.slice();
}

async function clearCollection(name) {
  const collection = db.collection(name);
  const countResult = await collection.count();
  const total = Number(countResult.total || 0);

  if (total <= 0) {
    return {
      name,
      deleted: 0,
      message: `${name}: 无数据`,
    };
  }

  let deleted = 0;

  while (true) {
    const result = await collection.limit(BATCH_SIZE).get();
    const currentPage = Array.isArray(result.data) ? result.data : [];

    if (!currentPage.length) {
      break;
    }

    for (const doc of currentPage) {
      await collection.doc(doc._id).remove();
      deleted += 1;
    }
  }

  return {
    name,
    deleted,
    message: `${name}: 删除 ${deleted} 条`,
  };
}

exports.main = async () => {
  try {
    const collectionNames = await getCollectionNames();
    const targetCollections = collectionNames.filter((name) => !PROTECTED_COLLECTIONS.has(name));
    const results = [];

    if (!targetCollections.length) {
      return {
        success: true,
        results: ['没有需要清空的集合'],
        protectedCollections: Array.from(PROTECTED_COLLECTIONS),
      };
    }

    for (const name of targetCollections) {
      try {
        const result = await clearCollection(name);
        results.push(result.message);
      } catch (error) {
        results.push(`${name}: ${error.message}`);
      }
    }

    return {
      success: true,
      results,
      protectedCollections: Array.from(PROTECTED_COLLECTIONS),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};
