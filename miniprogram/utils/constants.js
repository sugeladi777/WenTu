const STORAGE_KEYS = {
  USER_INFO: 'userInfo',
  PREFERRED_SEMESTER_ID: 'preferredSemesterId',
};

const SHIFT_TYPE = {
  NORMAL: 0,
  LEAVE: 1,
  SWAP: 2,
  BORROW: 3,
};

const LEAVE_STATUS = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
};

const ATTENDANCE_STATUS = {
  NORMAL: 0,
  LATE: 1,
  MISSING_CHECKOUT: 2,
  ABSENT: 3,
};

const USER_ROLE = {
  MEMBER: 0,
  LEADER: 1,
  ADMIN: 2,
};

const VIEW_MODE = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  SEMESTER: 'semester',
};

module.exports = {
  STORAGE_KEYS,
  SHIFT_TYPE,
  LEAVE_STATUS,
  ATTENDANCE_STATUS,
  USER_ROLE,
  VIEW_MODE,
};
