function parseMoneyToMinorUnit(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const normalized = String(value).trim().replace(/,/g, '');

  if (!normalized) {
    return 0;
  }

  const sign = normalized.startsWith('-') ? -1 : 1;
  const unsigned = normalized.replace(/^[+-]/, '');
  const [wholePart = '0', fractionPart = ''] = unsigned.split('.');
  const cents = `${fractionPart}00`.slice(0, 2);
  const whole = wholePart.replace(/\D/g, '') || '0';

  return sign * ((Number(whole) * 100) + Number(cents));
}

module.exports = {
  parseMoneyToMinorUnit,
};
