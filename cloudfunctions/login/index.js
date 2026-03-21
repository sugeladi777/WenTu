// 云函数入口文件
const cloud = require('wx-server-sdk');
const bcrypt = require('bcryptjs');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 加密密码
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

// 验证密码
const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

// 注册用户（创建用户时调用）
const registerUser = async (studentId, password, userInfo) => {
  const hashedPassword = await hashPassword(password);
  const result = await db.collection('users').add({
    data: {
      studentId,
      password: hashedPassword,
      name: userInfo.name || '',
      role: userInfo.role || 0,
      phone: userInfo.phone || '',
      avatar: '',
      rewardScore: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  });
  return result;
};

exports.main = async (event, context) => {
  const { studentId, password, action } = event;

  // 注册新用户
  if (action === 'register') {
    if (!studentId || !password) {
      return { success: false, error: '请输入学号和密码' };
    }

    try {
      // 检查用户是否已存在
      const existing = await db.collection('users').where({ studentId }).get();
      if (existing.data.length > 0) {
        return { success: false, error: '用户已存在' };
      }

      // 注册用户
      await registerUser(studentId, password, event);

      // 获取新注册的用户信息
      const newUser = await db.collection('users').where({ studentId }).get();
      const user = newUser.data[0];
      const { password: _, ...userInfo } = user;

      return { success: true, message: '注册成功', userInfo };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // 登录
  if (!studentId || !password) {
    return { success: false, error: '请输入学号和密码' };
  }

  try {
    const usersCollection = db.collection('users');
    const result = await usersCollection.where({ studentId }).get();

    if (result.data.length === 0) {
      return { success: false, error: '用户不存在' };
    }

    const user = result.data[0];
    const isMatch = await comparePassword(password, user.password);

    if (!isMatch) {
      return { success: false, error: '密码错误' };
    }

    // 返回用户信息（不包含密码）
    const { password: _, ...userInfo } = user;
    return { success: true, userInfo };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
