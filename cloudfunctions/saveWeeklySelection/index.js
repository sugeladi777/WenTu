/**
 * 保存用户周班次选择
 * 存储用户的班次偏好，用于容量统计和班次生成
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { semesterId, userId, preferences } = event;

  if (!semesterId || !userId) {
    return { success: false, error: '参数错误' };
  }

  try {
    const collection = db.collection('weeklySelections');

    // 检查是否已有记录
    const existing = await collection
      .where({ semesterId, userId })
      .get();

    if (existing.data && existing.data.length > 0) {
      // 更新现有记录
      await collection.doc(existing.data[0]._id).update({
        data: {
          preferences: preferences || [],
          updatedAt: new Date(),
        }
      });
    } else {
      // 创建新记录
      await collection.add({
        data: {
          semesterId,
          userId,
          preferences: preferences || [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
