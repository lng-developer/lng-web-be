function extractEmployeeCode(value) {
  return String(value || '').toUpperCase().match(/(?:^|[^A-Z0-9])(J\d{4})(?![A-Z0-9])/)?.[1] || null;
}

function parseSku(value) {
  const normalizedSku = String(value || '').trim().toUpperCase();
  const segments = normalizedSku.split('-').filter(Boolean);
  const employeeCode = /^J\d+$/.test(segments[0] || '') ? segments[0] : null;

  return {
    originalSku: normalizedSku,
    normalizedSku,
    segments,
    employeeCode,
    configCode: employeeCode && segments[1] ? segments[1] : null,
    dateCode: employeeCode && segments[2] ? segments[2] : null,
    sequence: employeeCode && segments.length >= 4 ? segments.slice(3).join('-') || null : null,
  };
}

module.exports = { extractEmployeeCode, parseSku };
