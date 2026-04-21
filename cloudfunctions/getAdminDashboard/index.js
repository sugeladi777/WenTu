const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];

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

function normalizeRoles(user = {}) {
  const roles = [];

  if (Array.isArray(user.roles)) {
    user.roles.forEach((item) => {
      const role = Number(item);
      if (VALID_ROLES.includes(role) && !roles.includes(role)) {
        roles.push(role);
      }
    });
  }

  const legacyRole = Number(user.role);
  if (!roles.length && VALID_ROLES.includes(legacyRole)) {
    roles.push(legacyRole);
  }

  if (!roles.includes(ROLE_MEMBER)) {
    roles.push(ROLE_MEMBER);
  }

  return roles.sort((left, right) => left - right);
}

function hasRole(user, role) {
  return normalizeRoles(user).includes(role);
}

function getPrimaryRole(roles) {
  if (roles.includes(ROLE_ADMIN)) {
    return ROLE_ADMIN;
  }

  if (roles.includes(ROLE_LEADER)) {
    return ROLE_LEADER;
  }

  return ROLE_MEMBER;
}

function omitPassword(user) {
  if (!user) {
    return null;
  }

  const { password, ...userInfo } = user;
  const roles = normalizeRoles(user);
  const primaryRole = getPrimaryRole(roles);

  return {
    ...userInfo,
    nickname: '',
    roles,
    role: primaryRole,
    primaryRole,
  };
}

async function loadAllDocuments(collection, filter = {}, options = {}) {
  const documents = [];
  const pageSize = options.pageSize || 100;
  let offset = 0;

  while (true) {
    let query = collection.where(filter);

    if (options.orderByField) {
      query = query.orderBy(options.orderByField, options.orderByOrder || 'asc');
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

async function loadOptionalDocuments(collectionName, filter = {}, options = {}) {
  try {
    return await loadAllDocuments(db.collection(collectionName), filter, options);
  } catch (error) {
    const message = String(error && error.message ? error.message : '');
    if (/collection/i.test(message) && /not\s*exist/i.test(message)) {
      return [];
    }
    throw error;
  }
}

async function findSemester(semesterId) {
  if (semesterId) {
    const result = await db.collection('semesters').doc(semesterId).get();
    return result.data || null;
  }

  const today = formatChinaDate();
  const activeResult = await db.collection('semesters')
    .where({
      status: 'active',
      startDate: db.command.lte(today),
      endDate: db.command.gte(today),
    })
    .orderBy('startDate', 'desc')
    .limit(1)
    .get();

  if (activeResult.data && activeResult.data[0]) {
    return activeResult.data[0];
  }

  const latestResult = await db.collection('semesters')
    .where({ status: 'active' })
    .orderBy('startDate', 'desc')
    .limit(1)
    .get();

  return latestResult.data && latestResult.data[0] ? latestResult.data[0] : null;
}

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !hasRole(user, ROLE_ADMIN)) {
    throw new Error('只有管理员可以执行该操作');
  }

  return user;
}

function buildSummary(users = []) {
  return {
    totalUserCount: users.length,
    memberCount: users.filter((user) => !hasRole(user, ROLE_LEADER) && !hasRole(user, ROLE_ADMIN)).length,
    leaderCount: users.filter((user) => hasRole(user, ROLE_LEADER)).length,
    adminCount: users.filter((user) => hasRole(user, ROLE_ADMIN)).length,
  };
}

function sortApplications(list = []) {
  return list.slice().sort((left, right) => {
    const leftDay = Number(left.dayOfWeek);
    const rightDay = Number(right.dayOfWeek);
    if (leftDay !== rightDay) {
      return leftDay - rightDay;
    }

    const startCompare = String(left.startTime || '').localeCompare(String(right.startTime || ''));
    if (startCompare !== 0) {
      return startCompare;
    }

    return String(left.userName || '').localeCompare(String(right.userName || ''));
  });
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();
  const semesterId = String(event.semesterId || '').trim();

  if (!requesterId) {
    return { success: false, error: '请求用户不能为空' };
  }

  try {
    await ensureAdmin(requesterId);

    const [semester, semesterList, users] = await Promise.all([
      findSemester(semesterId),
      loadAllDocuments(db.collection('semesters'), { status: 'active' }, {
        orderByField: 'startDate',
        orderByOrder: 'desc',
      }),
      loadAllDocuments(db.collection('users'), {}, { orderByField: 'studentId' }),
    ]);
    const leaderApplications = semester && semester._id
      ? sortApplications(await loadOptionalDocuments('leaderApplications', {
        semesterId: semester._id,
        status: 'pending',
      }))
      : [];

    return {
      success: true,
      semester,
      semesterList,
      summary: buildSummary(users),
      leaderApplications,
      users: users.map((user) => omitPassword(user)),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
