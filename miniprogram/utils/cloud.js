function normalizeError(error, fallbackMessage) {
  if (error instanceof Error) {
    return error;
  }

  const message = error && (error.message || error.errMsg)
    ? (error.message || error.errMsg)
    : (fallbackMessage || '请求失败');

  return new Error(message);
}

async function callCloudFunction(name, data = {}, options = {}) {
  try {
    const response = await wx.cloud.callFunction({ name, data });
    const result = response && response.result;

    if (!result) {
      throw new Error(options.emptyMessage || '服务未返回结果');
    }

    if (result.success === false) {
      throw new Error(result.error || options.failMessage || '请求失败');
    }

    return result;
  } catch (error) {
    throw normalizeError(error, options.failMessage);
  }
}

module.exports = {
  callCloudFunction,
};
