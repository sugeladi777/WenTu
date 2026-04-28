const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SHIFT_TYPE_LEAVE = 1;
const ATTENDANCE_NORMAL = 0;
const ATTENDANCE_ABSENT = 3;
const CHECK_IN_CONFIG_COLLECTION = 'systemConfig';
const CHECK_IN_CONFIG_DOC_ID = 'checkInPolicy';
const DEFAULT_CHECK_IN_RADIUS_METERS = 200;
const DEFAULT_CHECK_IN_POLICY = {
  enabled: true,
  latitude: 40.0042527778,
  longitude: 116.3282916667,
  radiusMeters: DEFAULT_CHECK_IN_RADIUS_METERS,
  placeName: '文图签到点',
};

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function toChinaDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const offsetMinutes = 8 * 60 + date.getTimezoneOffset();
  return new Date(date.getTime() + offsetMinutes * 60 * 1000);
}

function getChinaDateParts(input = new Date()) {
  const chinaDate = toChinaDate(input);
  return {
    year: chinaDate.getUTCFullYear(),
    month: chinaDate.getUTCMonth() + 1,
    day: chinaDate.getUTCDate(),
    hour: chinaDate.getUTCHours(),
    minute: chinaDate.getUTCMinutes(),
  };
}

function formatChinaDate(input = new Date()) {
  const parts = getChinaDateParts(input);
  return `${parts.year}-${padNumber(parts.month)}-${padNumber(parts.day)}`;
}

function timeToMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinutes(minutes) {
  const safeMinutes = Math.max(0, minutes);
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  return `${padNumber(hour)}:${padNumber(minute)}`;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isValidLatitude(latitude) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
}

function isValidLongitude(longitude) {
  return Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function calculateDistanceMeters(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(toLatitude - fromLatitude);
  const dLng = toRadians(toLongitude - fromLongitude);
  const lat1 = toRadians(fromLatitude);
  const lat2 = toRadians(toLatitude);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function normalizeCheckInPolicy(rawPolicy = {}) {
  const center = rawPolicy.center && typeof rawPolicy.center === 'object' ? rawPolicy.center : {};
  const latitude = toNumber(center.latitude != null ? center.latitude : rawPolicy.latitude);
  const longitude = toNumber(center.longitude != null ? center.longitude : rawPolicy.longitude);
  const radiusCandidate = toNumber(rawPolicy.radiusMeters);
  const radiusMeters = radiusCandidate && radiusCandidate > 0
    ? radiusCandidate
    : DEFAULT_CHECK_IN_POLICY.radiusMeters;
  const placeName = String(
    rawPolicy.placeName
    || rawPolicy.name
    || DEFAULT_CHECK_IN_POLICY.placeName
    || '指定签到点',
  ).trim() || '指定签到点';
  const enabled = rawPolicy.enabled == null
    ? DEFAULT_CHECK_IN_POLICY.enabled
    : Boolean(rawPolicy.enabled);

  return {
    enabled,
    latitude: latitude == null ? DEFAULT_CHECK_IN_POLICY.latitude : latitude,
    longitude: longitude == null ? DEFAULT_CHECK_IN_POLICY.longitude : longitude,
    radiusMeters,
    placeName,
  };
}

async function loadCheckInPolicy() {
  try {
    const result = await db.collection(CHECK_IN_CONFIG_COLLECTION).doc(CHECK_IN_CONFIG_DOC_ID).get();
    return normalizeCheckInPolicy(result.data || {});
  } catch (error) {
    const message = String(error && error.message ? error.message : '');
    if (
      (/collection/i.test(message) && /not\s*exist/i.test(message))
      || (/document/i.test(message) && /not\s*exist/i.test(message))
      || /does not exist/i.test(message)
    ) {
      return normalizeCheckInPolicy({});
    }
    throw error;
  }
}

function validateCheckInLocation(policy, latitude, longitude) {
  if (!policy || !policy.enabled) {
    return { ok: true, distanceMeters: null };
  }

  if (!isValidLatitude(policy.latitude) || !isValidLongitude(policy.longitude)) {
    return { ok: false, error: '签到位置配置异常，请联系管理员' };
  }

  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return { ok: false, error: '签到需要定位，请开启定位权限后重试' };
  }

  const distanceMeters = calculateDistanceMeters(
    latitude,
    longitude,
    policy.latitude,
    policy.longitude,
  );

  if (distanceMeters > policy.radiusMeters) {
    return {
      ok: false,
      error: `不在签到范围内，请前往${policy.placeName}附近（${Math.round(policy.radiusMeters)}米内）签到`,
      distanceMeters: Math.round(distanceMeters),
    };
  }

  return { ok: true, distanceMeters: Math.round(distanceMeters) };
}

function evaluateSchedule(schedule, currentMinutes) {
  if (!schedule) {
    return { ok: false, code: 'not_found', message: '班次不存在' };
  }

  if (schedule.checkInTime) {
    return { ok: false, code: 'checked_in', message: '该班次已经签到' };
  }

  if (schedule.attendanceStatus === ATTENDANCE_ABSENT) {
    return { ok: false, code: 'absent', message: '该班次已被标记为旷工' };
  }

  if (schedule.shiftType === SHIFT_TYPE_LEAVE) {
    return { ok: false, code: 'leave', message: '该班次已请假，不能签到' };
  }

  const startMinutes = timeToMinutes(schedule.startTime);
  const endMinutes = timeToMinutes(schedule.endTime);

  if (startMinutes === null || endMinutes === null) {
    return { ok: false, code: 'invalid_time', message: '班次时间配置异常' };
  }

  if (currentMinutes < startMinutes) {
    return {
      ok: false,
      code: 'too_early',
      message: `请在 ${formatMinutes(startMinutes)} 后签到`,
      availableAt: startMinutes,
    };
  }

  if (currentMinutes > endMinutes) {
    return { ok: false, code: 'expired', message: '已超过班次时间，不能签到' };
  }

  return {
    ok: true,
    attendanceStatus: ATTENDANCE_NORMAL,
  };
}

async function findTodaySchedules(userId, date) {
  const result = await db.collection('schedules')
    .where({ userId, date })
    .orderBy('startTime', 'asc')
    .limit(100)
    .get();

  return result.data || [];
}

exports.main = async (event) => {
  const userId = String(event.userId || '').trim();
  const date = String(event.date || '').trim() || formatChinaDate();
  const scheduleId = String(event.scheduleId || '').trim();
  const latitude = toNumber(event.latitude);
  const longitude = toNumber(event.longitude);

  if (!userId) {
    return { success: false, error: '用户ID不能为空' };
  }

  try {
    const nowParts = getChinaDateParts();
    const currentMinutes = nowParts.hour * 60 + nowParts.minute;
    let targetSchedule = null;
    let evaluation = null;

    if (scheduleId) {
      const scheduleResult = await db.collection('schedules').doc(scheduleId).get();
      targetSchedule = scheduleResult.data;

      if (!targetSchedule || targetSchedule.userId !== userId) {
        return { success: false, error: '找不到可签到的班次' };
      }

      if (targetSchedule.date !== date) {
        return { success: false, error: '只能签到当天班次' };
      }

      evaluation = evaluateSchedule(targetSchedule, currentMinutes);
    } else {
      const scheduleList = await findTodaySchedules(userId, date);

      if (scheduleList.length === 0) {
        return { success: false, error: '今日没有班次' };
      }

      let nearestAvailableAt = null;
      let expiredCount = 0;

      for (const schedule of scheduleList) {
        const currentEvaluation = evaluateSchedule(schedule, currentMinutes);
        if (currentEvaluation.ok) {
          targetSchedule = schedule;
          evaluation = currentEvaluation;
          break;
        }

        if (currentEvaluation.code === 'too_early') {
          nearestAvailableAt = nearestAvailableAt === null
            ? currentEvaluation.availableAt
            : Math.min(nearestAvailableAt, currentEvaluation.availableAt);
        }

        if (currentEvaluation.code === 'expired') {
          expiredCount += 1;
        }
      }

      if (!targetSchedule) {
        if (nearestAvailableAt !== null) {
          return { success: false, error: `请在 ${formatMinutes(nearestAvailableAt)} 后签到` };
        }

        if (expiredCount > 0) {
          return { success: false, error: '已超过班次时间，不能签到' };
        }

        return { success: false, error: '今日班次已处理完成' };
      }
    }

    if (!evaluation || !evaluation.ok) {
      return { success: false, error: evaluation ? evaluation.message : '签到失败' };
    }

    const checkInPolicy = await loadCheckInPolicy();
    const locationValidation = validateCheckInLocation(checkInPolicy, latitude, longitude);
    if (!locationValidation.ok) {
      return {
        success: false,
        error: locationValidation.error || '当前不满足签到位置要求',
        distanceMeters: locationValidation.distanceMeters || null,
      };
    }

    await db.collection('schedules').doc(targetSchedule._id).update({
      data: {
        checkInTime: db.serverDate(),
        attendanceStatus: evaluation.attendanceStatus,
        leaderConfirmStatus: targetSchedule.leaderUserId ? 'pending' : '',
        leaderConfirmedAt: null,
        leaderConfirmedBy: null,
        leaderConfirmedByName: '',
        checkInLocation: latitude !== null && longitude !== null
          ? {
            latitude,
            longitude,
            distanceMeters: locationValidation.distanceMeters,
          }
          : null,
        updatedAt: db.serverDate(),
      },
    });

    return {
      success: true,
      scheduleId: targetSchedule._id,
      attendanceStatus: evaluation.attendanceStatus,
      status: '签到成功',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
