const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_NORMAL = 0;

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

async function loadAllDocuments(collection, filter = {}) {
  const documents = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const result = await collection.where(filter).skip(offset).limit(pageSize).get();
    const currentPage = result.data || [];
    documents.push(...currentPage);

    if (currentPage.length < pageSize) {
      break;
    }

    offset += currentPage.length;
  }

  return documents;
}

async function loadOptionalDocuments(collectionName, filter = {}) {
  try {
    return await loadAllDocuments(db.collection(collectionName), filter);
  } catch (error) {
    const message = String(error && error.message ? error.message : '');
    if (/collection/i.test(message) && /not\s*exist/i.test(message)) {
      return [];
    }
    throw error;
  }
}

async function ensureCollectionExists(collectionName) {
  try {
    await db.collection(collectionName).limit(1).get();
  } catch (error) {
    const message = String(error && error.message ? error.message : '');
    if (!/collection/i.test(message) || !/not\s*exist/i.test(message)) {
      throw error;
    }

    if (typeof db.createCollection !== 'function') {
      throw new Error(`集合 ${collectionName} 不存在，请先在数据库中创建`);
    }

    try {
      await db.createCollection(collectionName);
    } catch (createError) {
      const createMessage = String(createError && createError.message ? createError.message : '');
      if (!/exists|already/i.test(createMessage)) {
        throw createError;
      }
    }
  }
}

async function ensureUser(userId) {
  const result = await db.collection('users').doc(userId).get();
  const user = result.data || null;

  if (!user) {
    throw new Error('用户不存在');
  }

  return user;
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

function getRecurringKey(schedule = {}) {
  const dayOfWeek = Number(schedule.dayOfWeek);
  if (schedule.shiftId) {
    return `${schedule.semesterId || ''}::${dayOfWeek}::${schedule.shiftId}`;
  }

  return `${schedule.semesterId || ''}::${dayOfWeek}::${schedule.startTime || ''}::${schedule.endTime || ''}`;
}

function buildRecurringMatcher(schedule = {}) {
  const matcher = {
    semesterId: schedule.semesterId,
    dayOfWeek: Number(schedule.dayOfWeek),
  };

  if (schedule.shiftId) {
    matcher.shiftId = schedule.shiftId;
    return matcher;
  }

  matcher.startTime = schedule.startTime;
  matcher.endTime = schedule.endTime;
  return matcher;
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const scheduleId = String(event.scheduleId || '').trim();

  if (!userId || !scheduleId) {
    return { success: false, error: '参数错误' };
  }

  try {
    const user = await ensureUser(userId);
    const scheduleResult = await db.collection('schedules').doc(scheduleId).get();
    const schedule = scheduleResult.data || null;

    if (!schedule || schedule.userId !== userId) {
      return { success: false, error: '找不到可申请的班次' };
    }

    if (schedule.shiftType !== SHIFT_TYPE_NORMAL) {
      return { success: false, error: '只能为固定正常班次申请班负' };
    }

    if (Number.isNaN(Number(schedule.dayOfWeek))) {
      return { success: false, error: '当前班次缺少固定班次信息' };
    }

    const semester = await findSemester(String(schedule.semesterId || '').trim());
    if (!semester || !semester._id || String(semester._id) !== String(schedule.semesterId || '')) {
      return { success: false, error: '当前班次不在可申请学期内' };
    }

    const recurringKey = getRecurringKey(schedule);
    const existingApplications = await loadOptionalDocuments('leaderApplications', {
      semesterId: schedule.semesterId,
      userId,
      status: 'pending',
    });
    const duplicatedPending = existingApplications.find((item) => getRecurringKey(item) === recurringKey);
    if (duplicatedPending) {
      return { success: false, error: '该固定班次已有待审批申请' };
    }

    const recurringSchedules = await loadAllDocuments(
      db.collection('schedules'),
      buildRecurringMatcher(schedule),
    );
    const currentLeaderSchedule = recurringSchedules.find((item) => String(item.leaderUserId || '').trim()) || null;
    if (currentLeaderSchedule && String(currentLeaderSchedule.leaderUserId || '').trim() === userId) {
      return { success: false, error: '你已经是这个固定班次的班负' };
    }

    await ensureCollectionExists('leaderApplications');

    await db.collection('leaderApplications').add({
      data: {
        semesterId: schedule.semesterId,
        semesterName: semester.name || '',
        userId,
        userName: String(user.name || '').trim(),
        studentId: String(user.studentId || '').trim(),
        scheduleId: schedule._id,
        shiftId: schedule.shiftId || '',
        shiftName: schedule.shiftName || '',
        startTime: schedule.startTime || '',
        endTime: schedule.endTime || '',
        fixedHours: Number(schedule.fixedHours || 0),
        dayOfWeek: Number(schedule.dayOfWeek),
        slotKey: recurringKey,
        currentLeaderUserId: currentLeaderSchedule ? String(currentLeaderSchedule.leaderUserId || '').trim() : '',
        currentLeaderUserName: currentLeaderSchedule ? String(currentLeaderSchedule.leaderUserName || '').trim() : '',
        status: 'pending',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
        reviewedAt: null,
        reviewedBy: '',
        reviewedByName: '',
      },
    });

    return {
      success: true,
      message: '班负申请已提交，等待管理员审批',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
