const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];

function normalizeString(value) {
  return String(value || '').trim();
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !normalizeRoles(user).includes(ROLE_ADMIN)) {
    throw new Error('只有管理员可以创建学期');
  }

  return user;
}

exports.main = async (event) => {
  const requesterId = normalizeString(event.requesterId);
  const name = normalizeString(event.name);
  const startDate = normalizeString(event.startDate);
  const endDate = normalizeString(event.endDate);

  if (!requesterId || !name || !startDate || !endDate) {
    return { success: false, error: '参数不完整' };
  }

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return { success: false, error: '日期格式应为 YYYY-MM-DD' };
  }

  if (startDate > endDate) {
    return { success: false, error: '学期开始时间不能晚于结束时间' };
  }

  try {
    await ensureAdmin(requesterId);

    const existing = await db.collection('semesters')
      .where({
        status: 'active',
        startDate: db.command.lte(endDate),
        endDate: db.command.gte(startDate),
      })
      .limit(1)
      .get();

    if (existing.data && existing.data.length > 0) {
      return { success: false, error: '该时间段与已有学期重叠' };
    }

    const result = await db.collection('semesters').add({
      data: {
        name,
        startDate,
        endDate,
        status: 'active',
        selectionEditWindowEnabled: false,
        selectionEditStartAt: '',
        selectionEditEndAt: '',
        createdBy: requesterId,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });

    return { success: true, semesterId: result._id, message: '学期创建成功' };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
