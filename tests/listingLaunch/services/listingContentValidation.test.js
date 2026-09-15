const { validateContent } = require('../../../src/modules/listingLaunch/services/listingContentValidation');
const { listingContentProfile } = require('../../../src/modules/listingLaunch/constants/listingContentProfile');

const snapshot = { availableColors: [{ code: 'BLACK', label: 'Black' }, { code: 'NAVY', label: 'Navy' }, { code: 'WHITE', label: 'White' }] };
const valid = () => ({ title: 'Cat accountant shirt', bullets: ['One', 'Two', 'Three', 'Four', 'Five'], searchTerms: ['cat accountant', 'gift'], recommendedColors: [{ code: 'BLACK', reason: 'Matches the theme.' }] });

function expectInvalid(content, field, code) {
  let error;
  try { validateContent(content, snapshot, listingContentProfile); } catch (caught) { error = caught; }
  expect(error).toMatchObject({ code: 'CONTENT_VALIDATION_FAILED', statusCode: 400,
    details: { fieldErrors: expect.arrayContaining([expect.objectContaining({ field, ...(code && { code }) })]) } });
  return error;
}

test('returns independent plain content without trimming or mutating seller edits', () => {
  const input = valid();
  input.title = '  A shirt  ';
  const output = validateContent(input, snapshot, listingContentProfile);
  expect(output).toEqual(input);
  output.bullets[0] = 'Changed';
  output.recommendedColors[0].reason = 'Changed';
  expect(input.bullets[0]).toBe('One');
  expect(input.recommendedColors[0].reason).toBe('Matches the theme.');
});

test.each([null, [], 'text', 1].map((content) => [content]))('rejects non-object content %p', (content) => { expectInvalid(content, 'content'); });
test.each([4, 6])('requires five bullets, rejects %i', (count) => { expectInvalid({ ...valid(), bullets: Array(count).fill('Bullet') }, 'bullets'); });
test.each(['black', ' BLACK ', 'VINTAGE_BLACK', 'Black', 'RED'])('rejects color code without repairing %s', (code) => {
  expectInvalid({ ...valid(), recommendedColors: [{ code, reason: 'Theme' }] }, 'recommendedColors[0].code', 'COLOR_NOT_ALLOWED');
});
test.each([[], ['BLACK'], [null], [{ code: 'BLACK', reason: '' }], Array(4).fill({ code: 'BLACK', reason: 'Theme' })].map((colors) => [colors]))('rejects malformed recommendations %p', (recommendedColors) => {
  expect(() => validateContent({ ...valid(), recommendedColors }, snapshot)).toThrow();
});
test('rejects duplicate recommendation codes', () => { expectInvalid({ ...valid(), recommendedColors: [{ code: 'BLACK', reason: 'One' }, { code: 'BLACK', reason: 'Two' }] }, 'recommendedColors', 'DUPLICATE_COLOR'); });
test('rejects extra fields without exposing attacker-controlled field names', () => {
  const error = expectInvalid({ ...valid(), 'secret-output-marker': 'private' }, 'content', 'UNKNOWN_FIELDS');
  expect(JSON.stringify(error)).not.toContain('secret-output-marker');
  expectInvalid({ ...valid(), recommendedColors: [{ code: 'BLACK', reason: 'Theme', private: true }] }, 'recommendedColors[0]', 'UNKNOWN_FIELDS');
});
test.each([['title', '😀'.repeat(201)], ['bullets', ['😀'.repeat(501), 'Two', 'Three', 'Four', 'Five']], ['title', '  '], ['title', 8], ['searchTerms', []], ['searchTerms', Array.from({ length: 51 }, (_, i) => `${i}`)]])('rejects invalid %s', (field, value) => {
  expect(() => validateContent({ ...valid(), [field]: value }, snapshot)).toThrow();
});
test('counts Unicode code points rather than UTF-16 units for title bullets and reasons', () => {
  const content = { ...valid(), title: '😀'.repeat(200), bullets: Array(5).fill('😀'.repeat(500)), recommendedColors: [{ code: 'WHITE', reason: '😀'.repeat(300) }] };
  expect(validateContent(content, snapshot)).toEqual(content);
  expectInvalid({ ...content, recommendedColors: [{ code: 'WHITE', reason: '😀'.repeat(301) }] }, 'recommendedColors[0].reason');
});
test.each([['gift', 'GIFT'], ['gift', ' gift '], ['cat shirt', 'CAT  SHIRT']])('rejects repeated search terms %p', (...searchTerms) => {
  expectInvalid({ ...valid(), searchTerms }, 'searchTerms', 'DUPLICATE_TERM');
});
test('rejects empty search terms', () => { expectInvalid({ ...valid(), searchTerms: ['gift', ''] }, 'searchTerms[1]'); });
test('accepts 249 bytes and rejects 250 UTF-8 bytes without truncating', () => {
  expect(validateContent({ ...valid(), searchTerms: ['é'.repeat(123), 'ab'] }, snapshot).searchTerms).toEqual(['é'.repeat(123), 'ab']);
  expectInvalid({ ...valid(), searchTerms: ['é'.repeat(124), 'a'] }, 'searchTerms', 'UTF8_LIMIT');
});
test('bounds error entries and never echoes invalid content', () => {
  const error = expectInvalid({ ...valid(), bullets: Array(5).fill(''), searchTerms: Array(50).fill(null), recommendedColors: [{ code: 'secret-output-marker', reason: '' }] }, 'bullets[0]');
  expect(error.details.fieldErrors.length).toBeLessThanOrEqual(20);
  expect(JSON.stringify(error)).not.toContain('secret-output-marker');
});
