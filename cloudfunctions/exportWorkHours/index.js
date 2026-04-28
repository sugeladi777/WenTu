const cloud = require('wx-server-sdk');
const XLSX = require('xlsx');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ROLE_MEMBER = 0;
const ROLE_LEADER = 1;
const ROLE_ADMIN = 2;
const VALID_ROLES = [ROLE_MEMBER, ROLE_LEADER, ROLE_ADMIN];
const ATTENDANCE_NORMAL = 0;
const ATTENDANCE_LATE = 1;
const ATTENDANCE_MISSING_CHECKOUT = 2;
const ATTENDANCE_ABSENT = 3;
const SHIFT_TYPE_NORMAL = 0;
const SHIFT_TYPE_LEAVE = 1;
const SHIFT_TYPE_SWAP = 2;
const SHIFT_TYPE_BORROW = 3;

function roundNumber(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function toChinaDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const offsetMinutes = 8 * 60 + date.getTimezoneOffset();
  return new Date(date.getTime() + offsetMinutes * 60 * 1000);
}

function formatChinaDate(input = new Date()) {
  const chinaDate = toChinaDate(input);
  if (!chinaDate) {
    return '';
  }
  return `${chinaDate.getUTCFullYear()}-${padNumber(chinaDate.getUTCMonth() + 1)}-${padNumber(chinaDate.getUTCDate())}`;
}

function formatChinaDateTime(input = new Date()) {
  const chinaDate = toChinaDate(input);
  if (!chinaDate) {
    return '';
  }
  return `${formatChinaDate(chinaDate)} ${padNumber(chinaDate.getUTCHours())}:${padNumber(chinaDate.getUTCMinutes())}:${padNumber(chinaDate.getUTCSeconds())}`;
}

function formatFileToken(input = new Date()) {
  const chinaDate = toChinaDate(input) || toChinaDate(new Date());
  return [
    chinaDate.getUTCFullYear(),
    padNumber(chinaDate.getUTCMonth() + 1),
    padNumber(chinaDate.getUTCDate()),
    padNumber(chinaDate.getUTCHours()),
    padNumber(chinaDate.getUTCMinutes()),
    padNumber(chinaDate.getUTCSeconds()),
  ].join('');
}

function getChinaMinutes(input = new Date()) {
  const chinaDate = toChinaDate(input) || toChinaDate(new Date());
  return chinaDate.getUTCHours() * 60 + chinaDate.getUTCMinutes();
}

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
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

function getRoleText(user = {}) {
  const roles = normalizeRoles(user);
  const labels = [];

  if (roles.includes(ROLE_MEMBER)) {
    labels.push('志愿者');
  }
  if (roles.includes(ROLE_LEADER)) {
    labels.push('班负');
  }
  if (roles.includes(ROLE_ADMIN)) {
    labels.push('管理员');
  }

  return labels.join(' / ');
}

async function ensureAdmin(requesterId) {
  const result = await db.collection('users').doc(requesterId).get();
  const user = result.data || null;

  if (!user || !hasRole(user, ROLE_ADMIN)) {
    throw new Error('只有管理员可以导出数据');
  }

  return user;
}

async function loadAllDocuments(collection, filter = {}) {
  const pageSize = 100;
  const documents = [];
  let offset = 0;

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

function buildDateTimeValue(dateString, timeString) {
  const safeDate = String(dateString || '').trim();
  const safeTime = String(timeString || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate) || !/^\d{2}:\d{2}$/.test(safeTime)) {
    return Number.NaN;
  }

  return new Date(`${safeDate}T${safeTime}:00+08:00`).getTime();
}

function resolveRange(event = {}) {
  const startDate = String(event.startDate || '').trim();
  const startTime = String(event.startTime || '').trim();
  const endDate = String(event.endDate || '').trim();
  const endTime = String(event.endTime || '').trim();

  if (!startDate || !startTime || !endDate || !endTime) {
    throw new Error('请完整选择开始和结束时间');
  }

  const startValue = buildDateTimeValue(startDate, startTime);
  const endValue = buildDateTimeValue(endDate, endTime);

  if (Number.isNaN(startValue) || Number.isNaN(endValue)) {
    throw new Error('时间格式不正确');
  }

  if (startValue > endValue) {
    throw new Error('开始时间不能晚于结束时间');
  }

  return {
    startDate,
    startTime,
    endDate,
    endTime,
    startValue,
    endValue,
    label: `${startDate} ${startTime} - ${endDate} ${endTime}`,
  };
}

function scheduleOverlapsRange(schedule = {}, range) {
  const startValue = buildDateTimeValue(schedule.date, schedule.startTime || '00:00');
  const endValue = buildDateTimeValue(schedule.date, schedule.endTime || '23:59');

  if (Number.isNaN(startValue) || Number.isNaN(endValue)) {
    return false;
  }

  return endValue >= range.startValue && startValue <= range.endValue;
}

function getEffectiveAttendanceStatus(schedule = {}) {
  if (!schedule || Number(schedule.shiftType) === SHIFT_TYPE_LEAVE) {
    return schedule ? schedule.attendanceStatus : null;
  }

  if (schedule.attendanceStatus === ATTENDANCE_ABSENT) {
    return ATTENDANCE_ABSENT;
  }

  if (schedule.attendanceStatus === ATTENDANCE_MISSING_CHECKOUT) {
    return ATTENDANCE_MISSING_CHECKOUT;
  }

  if (schedule.checkOutTime) {
    return schedule.attendanceStatus;
  }

  if (!schedule.date) {
    return schedule.attendanceStatus;
  }

  const endMinutes = timeToMinutes(schedule.endTime);
  if (endMinutes === null) {
    return schedule.attendanceStatus;
  }

  const today = formatChinaDate();
  const currentMinutes = getChinaMinutes();
  const cutoffPassed = schedule.date < today || (schedule.date === today && currentMinutes > endMinutes + 30);

  if (!cutoffPassed) {
    return schedule.attendanceStatus;
  }

  if (!schedule.checkInTime) {
    return ATTENDANCE_ABSENT;
  }

  return ATTENDANCE_MISSING_CHECKOUT;
}

function getScheduleHoursMeta(schedule = {}) {
  const effectiveAttendanceStatus = getEffectiveAttendanceStatus(schedule);
  const isValid = Boolean(
    schedule.checkOutTime
    && (effectiveAttendanceStatus === ATTENDANCE_NORMAL || effectiveAttendanceStatus === ATTENDANCE_LATE)
    && Number(schedule.shiftType) !== SHIFT_TYPE_LEAVE
    && effectiveAttendanceStatus !== ATTENDANCE_ABSENT,
  );

  if (!isValid) {
    return {
      effectiveAttendanceStatus,
      isValid: false,
      shiftHours: 0,
      approvedOvertimeHours: 0,
      actualHours: 0,
    };
  }

  const shiftHours = roundNumber(schedule.fixedHours || 0);
  const approvedOvertimeHours = schedule.overtimeApproved
    ? roundNumber(schedule.overtimeHours || 0)
    : 0;

  return {
    effectiveAttendanceStatus,
    isValid: true,
    shiftHours,
    approvedOvertimeHours,
    actualHours: roundNumber(shiftHours + approvedOvertimeHours),
  };
}

function getShiftTypeText(shiftType) {
  switch (Number(shiftType)) {
    case SHIFT_TYPE_LEAVE:
      return '请假';
    case SHIFT_TYPE_SWAP:
      return '替班';
    case SHIFT_TYPE_BORROW:
      return '蹭班';
    case SHIFT_TYPE_NORMAL:
    default:
      return '正常';
  }
}

function getScheduleTypeText(schedule = {}, scheduleMap = {}) {
  if (Number(schedule.shiftType) === SHIFT_TYPE_LEAVE && !shouldCountAsLeave(schedule, scheduleMap)) {
    return '已替班';
  }

  return getShiftTypeText(schedule.shiftType);
}

function getAttendanceText(schedule = {}, effectiveAttendanceStatus, scheduleMap = {}) {
  if (Number(schedule.shiftType) === SHIFT_TYPE_LEAVE) {
    if (!shouldCountAsLeave(schedule, scheduleMap)) {
      return '已被替班，不计请假';
    }

    return schedule.replacementUserId ? '已请假，已被接替' : '已请假';
  }

  if (effectiveAttendanceStatus === ATTENDANCE_ABSENT) {
    return '旷岗';
  }

  if (!schedule.checkInTime) {
    return '未签到';
  }

  if (effectiveAttendanceStatus === ATTENDANCE_MISSING_CHECKOUT) {
    return '未签退';
  }

  if (!schedule.checkOutTime) {
    return effectiveAttendanceStatus === ATTENDANCE_LATE ? '已签到 / 迟到' : '已签到';
  }

  if (effectiveAttendanceStatus === ATTENDANCE_LATE) {
    return '迟到';
  }

  return '正常';
}

function getEvaluationText(schedule = {}, effectiveAttendanceStatus, scheduleMap = {}) {
  if (Number(schedule.shiftType) === SHIFT_TYPE_LEAVE) {
    if (!shouldCountAsLeave(schedule, scheduleMap)) {
      return '已由他人替班，不计请假';
    }

    return schedule.replacementUserId ? '请假，已由他人替班' : '请假，待替班';
  }

  const attendanceText = getAttendanceText(schedule, effectiveAttendanceStatus, scheduleMap);
  if (schedule.shiftType === SHIFT_TYPE_SWAP) {
    return `替班记录 · ${attendanceText}`;
  }

  if (schedule.shiftType === SHIFT_TYPE_BORROW) {
    return `蹭班记录 · ${attendanceText}`;
  }

  return attendanceText;
}

function getRelatedRecordText(schedule = {}, scheduleMap = {}) {
  if (Number(schedule.shiftType) === SHIFT_TYPE_LEAVE) {
    if (!shouldCountAsLeave(schedule, scheduleMap)) {
      return schedule.replacementUserName
        ? `替班同学：${schedule.replacementUserName}（不计请假）`
        : '已被替班，不计请假';
    }

    return schedule.replacementUserName
      ? `替班同学：${schedule.replacementUserName}`
      : '暂未被认领';
  }

  if (schedule.shiftType === SHIFT_TYPE_SWAP) {
    return schedule.originalUserName
      ? `替班对象：${schedule.originalUserName}`
      : '替班记录';
  }

  if (schedule.shiftType === SHIFT_TYPE_BORROW) {
    return '新增蹭班记录';
  }

  return '';
}

function shouldCountAsLeave(schedule = {}, scheduleMap = {}) {
  if (!schedule || Number(schedule.shiftType) !== SHIFT_TYPE_LEAVE) {
    return false;
  }

  if (typeof schedule.leaveCountsAsLeave === 'boolean') {
    return schedule.leaveCountsAsLeave;
  }

  if (!schedule.replacementUserId && !schedule.replacementScheduleId) {
    return true;
  }

  const replacementScheduleId = String(schedule.replacementScheduleId || '').trim();
  const replacementSchedule = replacementScheduleId ? scheduleMap[replacementScheduleId] : null;

  if (replacementSchedule) {
    return Number(replacementSchedule.shiftType) !== SHIFT_TYPE_SWAP;
  }

  return false;
}

function createEmptyUserStats(user = {}) {
  return {
    userId: user._id || '',
    studentId: String(user.studentId || '').trim(),
    name: String(user.name || '').trim(),
    roleText: getRoleText(user),
    validHours: 0,
    shiftHours: 0,
    overtimeHours: 0,
    validShiftCount: 0,
    swapCount: 0,
    leaveCount: 0,
    borrowCount: 0,
    lateCount: 0,
    absentCount: 0,
    missingCheckoutCount: 0,
    paidHours: 0,
    unpaidHours: 0,
    paidAmount: 0,
  };
}

function sortUsers(users = []) {
  return users.slice().sort((left, right) => {
    const leftStudentId = String(left.studentId || '');
    const rightStudentId = String(right.studentId || '');

    if (leftStudentId !== rightStudentId) {
      return leftStudentId.localeCompare(rightStudentId);
    }

    return String(left.name || '').localeCompare(String(right.name || ''));
  });
}

function sortSchedules(schedules = []) {
  return schedules.slice().sort((left, right) => {
    if (left.date !== right.date) {
      return String(left.date || '').localeCompare(String(right.date || ''));
    }

    const startCompare = String(left.startTime || '').localeCompare(String(right.startTime || ''));
    if (startCompare !== 0) {
      return startCompare;
    }

    return String(left.userName || left.userId || '').localeCompare(String(right.userName || right.userId || ''));
  });
}

function createSummarySheet(rows, meta) {
  const data = [
    ['导出时间', meta.generatedAt, '统计范围', meta.rangeLabel],
    [],
    ['序号', '学号', '姓名', '身份', '有效工时', '基础工时', '加班工时', '有效班次', '请假班次', '替班班次', '蹭班班次', '迟到班次', '旷岗班次', '未签退班次', '已发薪工时', '未发薪工时', '已发薪金额'],
  ];

  rows.forEach((item, index) => {
    data.push([
      index + 1,
      item.studentId,
      item.name,
      item.roleText,
      item.validHours,
      item.shiftHours,
      item.overtimeHours,
      item.validShiftCount,
      item.leaveCount,
      item.swapCount,
      item.borrowCount,
      item.lateCount,
      item.absentCount,
      item.missingCheckoutCount,
      item.paidHours,
      item.unpaidHours,
      item.paidAmount,
    ]);
  });

  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = [
    { wch: 8 },
    { wch: 14 },
    { wch: 12 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
  ];
  return sheet;
}

function createDetailSheet(rows, meta) {
  const data = [
    ['导出时间', meta.generatedAt, '统计范围', meta.rangeLabel],
    [],
    ['日期', '开始时间', '结束时间', '学号', '姓名', '班次名称', '班次类型', '考评记录', '考勤状态', '签到时间', '签退时间', '有效工时', '基础工时', '加班工时', '工资状态', '工资金额', '班负姓名', '关联记录', '请假原因'],
  ];

  rows.forEach((item) => {
    data.push([
      item.date,
      item.startTime,
      item.endTime,
      item.studentId,
      item.name,
      item.shiftName,
      item.shiftTypeText,
      item.evaluationText,
      item.attendanceText,
      item.checkInTimeText,
      item.checkOutTimeText,
      item.actualHours,
      item.shiftHours,
      item.overtimeHours,
      item.salaryPaidText,
      item.salaryAmount,
      item.leaderUserName,
      item.relatedRecordText,
      item.leaveReason,
    ]);
  });

  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = [
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
    { wch: 12 },
    { wch: 18 },
    { wch: 10 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    { wch: 20 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 22 },
    { wch: 24 },
  ];
  return sheet;
}

exports.main = async (event) => {
  const requesterId = String(event.requesterId || '').trim();

  if (!requesterId) {
    return { success: false, error: '请求用户不能为空' };
  }

  try {
    await ensureAdmin(requesterId);
    const range = resolveRange(event);

    const [users, schedules] = await Promise.all([
      loadAllDocuments(db.collection('users')),
      loadAllDocuments(db.collection('schedules'), {
        date: db.command.gte(range.startDate).and(db.command.lte(range.endDate)),
      }),
    ]);

    const userMap = new Map();
    const statsMap = new Map();

    sortUsers(users).forEach((user) => {
      userMap.set(user._id, user);
      statsMap.set(user._id, createEmptyUserStats(user));
    });

    const rangedSchedules = sortSchedules(
      schedules.filter((schedule) => scheduleOverlapsRange(schedule, range))
    );
    const scheduleMap = schedules.reduce((map, schedule) => {
      if (schedule && schedule._id) {
        map[String(schedule._id)] = schedule;
      }

      return map;
    }, {});

    const detailRows = [];

    rangedSchedules.forEach((schedule) => {
      const user = userMap.get(schedule.userId) || {
        _id: schedule.userId,
        studentId: schedule.studentId || '',
        name: schedule.userName || '',
        role: ROLE_MEMBER,
        roles: [ROLE_MEMBER],
      };
      const stats = statsMap.get(schedule.userId) || createEmptyUserStats(user);
      const hoursMeta = getScheduleHoursMeta(schedule);

      if (shouldCountAsLeave(schedule, scheduleMap)) {
        stats.leaveCount += 1;
      }
      if (schedule.shiftType === SHIFT_TYPE_SWAP) {
        stats.swapCount += 1;
      }
      if (schedule.shiftType === SHIFT_TYPE_BORROW) {
        stats.borrowCount += 1;
      }
      if (hoursMeta.effectiveAttendanceStatus === ATTENDANCE_LATE) {
        stats.lateCount += 1;
      }
      if (hoursMeta.effectiveAttendanceStatus === ATTENDANCE_ABSENT) {
        stats.absentCount += 1;
      }
      if (hoursMeta.effectiveAttendanceStatus === ATTENDANCE_MISSING_CHECKOUT) {
        stats.missingCheckoutCount += 1;
      }

      if (hoursMeta.isValid) {
        stats.validHours = roundNumber(stats.validHours + hoursMeta.actualHours);
        stats.shiftHours = roundNumber(stats.shiftHours + hoursMeta.shiftHours);
        stats.overtimeHours = roundNumber(stats.overtimeHours + hoursMeta.approvedOvertimeHours);
        stats.validShiftCount += 1;

        if (schedule.salaryPaid) {
          stats.paidHours = roundNumber(stats.paidHours + hoursMeta.actualHours);
          stats.paidAmount = roundNumber(stats.paidAmount + Number(schedule.salaryAmount || 0));
        } else {
          stats.unpaidHours = roundNumber(stats.unpaidHours + hoursMeta.actualHours);
        }
      }

      statsMap.set(schedule.userId, stats);

      detailRows.push({
        date: schedule.date || '',
        startTime: schedule.startTime || '',
        endTime: schedule.endTime || '',
        studentId: stats.studentId || '-',
        name: stats.name || '未命名用户',
        shiftName: schedule.shiftName || '',
        shiftTypeText: getScheduleTypeText(schedule, scheduleMap),
        evaluationText: getEvaluationText(schedule, hoursMeta.effectiveAttendanceStatus, scheduleMap),
        attendanceText: getAttendanceText(schedule, hoursMeta.effectiveAttendanceStatus, scheduleMap),
        checkInTimeText: formatChinaDateTime(schedule.checkInTime),
        checkOutTimeText: formatChinaDateTime(schedule.checkOutTime),
        actualHours: hoursMeta.actualHours,
        shiftHours: hoursMeta.shiftHours,
        overtimeHours: hoursMeta.approvedOvertimeHours,
        salaryPaidText: schedule.salaryPaid ? '已发放' : '未发放',
        salaryAmount: roundNumber(schedule.salaryAmount || 0),
        leaderUserName: schedule.leaderUserName || '',
        relatedRecordText: getRelatedRecordText(schedule, scheduleMap),
        leaveReason: schedule.leaveReason || '',
      });
    });

    const summaryRows = Array.from(statsMap.values())
      .sort((left, right) => {
        if (left.studentId !== right.studentId) {
          return String(left.studentId || '').localeCompare(String(right.studentId || ''));
        }

        return String(left.name || '').localeCompare(String(right.name || ''));
      })
      .map((item) => ({
        ...item,
        studentId: item.studentId || '-',
        name: item.name || '未命名用户',
        roleText: item.roleText || '志愿者',
      }));

    const workbook = XLSX.utils.book_new();
    const meta = {
      generatedAt: formatChinaDateTime(),
      rangeLabel: range.label,
    };

    XLSX.utils.book_append_sheet(workbook, createSummarySheet(summaryRows, meta), '工时汇总');
    XLSX.utils.book_append_sheet(workbook, createDetailSheet(detailRows, meta), '班次考评明细');

    const fileBuffer = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'buffer',
    });

    const fileName = `工时报表_${range.startDate}_${range.startTime.replace(':', '')}_${range.endDate}_${range.endTime.replace(':', '')}.xlsx`;
    const cloudPath = `admin-reports/${formatFileToken()}_${Date.now()}_work_hours.xlsx`;
    const uploadResult = await cloud.uploadFile({
      cloudPath,
      fileContent: fileBuffer,
    });

    return {
      success: true,
      fileID: uploadResult.fileID,
      fileName,
      userCount: summaryRows.length,
      scheduleCount: detailRows.length,
      rangeLabel: range.label,
      message: '工时报表已生成',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

