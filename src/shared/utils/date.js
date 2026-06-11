function convertToUTC(dateStringOrObject) {
  if (!dateStringOrObject) {
    return null;
  }

  const date = dateStringOrObject instanceof Date
    ? new Date(dateStringOrObject.getTime())
    : new Date(dateStringOrObject);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Date(date.toISOString());
}

function toISOString(dateStringOrObject) {
  const date = convertToUTC(dateStringOrObject);
  return date ? date.toISOString() : null;
}

function addDays(dateStringOrObject, days) {
  const date = convertToUTC(dateStringOrObject);

  if (!date || !Number.isFinite(days)) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function startOfUTCDay(dateStringOrObject) {
  const date = convertToUTC(dateStringOrObject);

  if (!date) {
    return null;
  }

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUTCDay(dateStringOrObject) {
  const start = startOfUTCDay(dateStringOrObject);

  if (!start) {
    return null;
  }

  start.setUTCHours(23, 59, 59, 999);
  return start;
}

module.exports = {
  convertToUTC,
  toISOString,
  addDays,
  startOfUTCDay,
  endOfUTCDay,
};
