const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const COLLECTIONS = [
  'users',
  'semesters',
  'shiftTemplates',
  'schedules',
  'weeklySelections',
  'shiftRequests',
  'leaderApplications',
];

exports.main = async () => {
  try {
    for (const name of COLLECTIONS) {
      try {
        await db.createCollection(name);
      } catch (error) {
        const message = String(error && error.message ? error.message : '');
        if (!/exists|already/i.test(message)) {
          throw error;
        }
      }
    }

    return {
      success: true,
      message: '数据库初始化完成',
      collections: COLLECTIONS,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};
