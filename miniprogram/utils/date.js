function padNumber(value) {
  return String(value).padStart(2, '0');
}

function parseDateString(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function parseDateTime(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string') {
    const pureDate = parseDateString(value);
    if (pureDate) {
      return pureDate;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'object') {
    if (typeof value.seconds === 'number') {
      return new Date(value.seconds * 1000);
    }

    if (value.$date) {
      const parsed = new Date(value.$date);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
}

function cloneDate(date) {
  return new Date(date.getTime());
}

function formatDate(value) {
  const date = parseDateTime(value);
  if (!date) {
    return '';
  }

  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function formatTime(value) {
  const date = parseDateTime(value);
  if (!date) {
    return '--';
  }

  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

function formatDateTime(value) {
  const date = parseDateTime(value);
  if (!date) {
    return '--';
  }

  return `${formatDate(date)} ${formatTime(date)}`;
}

function formatMonthLabel(value) {
  const date = parseDateTime(value) || new Date();
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function getDayIndex(value) {
  const date = parseDateTime(value);
  if (!date) {
    return 0;
  }

  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

function getWeekStartDate(value) {
  const date = parseDateTime(value) || new Date();
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - getDayIndex(result));
  return result;
}

function getWeekDates(value) {
  const monday = getWeekStartDate(value);
  const dates = [];

  for (let index = 0; index < 7; index += 1) {
    const current = cloneDate(monday);
    current.setDate(monday.getDate() + index);
    dates.push({
      raw: formatDate(current),
      label: `${current.getMonth() + 1}/${current.getDate()}`,
    });
  }

  return dates;
}

function compareDateString(left, right) {
  return String(left || '').localeCompare(String(right || ''));
}

function getDateRange(viewMode, baseDate = new Date()) {
  const current = parseDateTime(baseDate) || new Date();

  if (viewMode === 'semester') {
    return {
      startDate: '',
      endDate: '',
      label: '本学期',
    };
  }

  if (viewMode === 'month') {
    const startDate = new Date(current.getFullYear(), current.getMonth(), 1);
    const endDate = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    return {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      label: formatMonthLabel(current),
    };
  }

  if (viewMode === 'week') {
    const monday = getWeekStartDate(current);
    const sunday = cloneDate(monday);
    sunday.setDate(monday.getDate() + 6);

    return {
      startDate: formatDate(monday),
      endDate: formatDate(sunday),
      label: `${monday.getMonth() + 1}/${monday.getDate()} - ${sunday.getMonth() + 1}/${sunday.getDate()}`,
    };
  }

  const today = formatDate(current);
  return {
    startDate: today,
    endDate: today,
    label: today,
  };
}

module.exports = {
  compareDateString,
  formatDate,
  formatDateTime,
  formatMonthLabel,
  formatTime,
  getDateRange,
  getDayIndex,
  getWeekDates,
  getWeekStartDate,
  parseDateString,
  parseDateTime,
};
