const cloud = require('wx-server-sdk');
const bcrypt = require('bcryptjs');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function normalizePassword(value) {
  return String(value || '');
}

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const oldPassword = normalizePassword(event.oldPassword);
  const newPassword = normalizePassword(event.newPassword);

  if (!userId) {
    return { success: false, error: '用户 ID 不能为空' };
  }

  if (!oldPassword || !newPassword) {
    return { success: false, error: '请填写完整密码信息' };
  }

  if (newPassword.length < 6) {
    return { success: false, error: '新密码至少 6 位' };
  }

  try {
    const userResult = await db.collection('users').doc(userId).get();
    if (!userResult.data) {
      return { success: false, error: '用户不存在' };
    }

    const user = userResult.data;
    const isMatch = await comparePassword(oldPassword, user.password);
    if (!isMatch) {
      return { success: false, error: '当前密码错误' };
    }

    const isSamePassword = await comparePassword(newPassword, user.password);
    if (isSamePassword) {
      return { success: false, error: '新密码不能与旧密码相同' };
    }

    const password = await hashPassword(newPassword);

    await db.collection('users').doc(userId).update({
      data: {
        password,
        updatedAt: db.serverDate(),
      },
    });

    return {
      success: true,
      message: '密码修改成功',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
