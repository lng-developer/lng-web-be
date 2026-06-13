const {
  buildPrefixRegex,
  escapeRegex,
  normalizeSearchTerm,
} = require('../../../shared/utils/search');

describe('search utils', () => {
  test('escapeRegex treats user input as literal text', () => {
    expect(escapeRegex('A+B*C?')).toBe('A\\+B\\*C\\?');
  });

  test('buildPrefixRegex anchors escaped input', () => {
    const regex = buildPrefixRegex('AUTH:');

    expect(regex.test('AUTH:READ')).toBe(true);
    expect(regex.test('XAUTH:READ')).toBe(false);
  });

  test('normalizeSearchTerm trims and caps long input', () => {
    expect(normalizeSearchTerm('  ABC  ')).toBe('ABC');
    expect(normalizeSearchTerm('123456', { maxLength: 3 })).toBe('123');
  });
});
