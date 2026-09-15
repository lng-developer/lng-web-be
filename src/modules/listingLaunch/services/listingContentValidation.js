const AppError = require('../../../shared/errors/appError');
const { listingContentProfile } = require('../constants/listingContentProfile');

function validateContent(content, snapshot, profile = listingContentProfile) {
  const { limits } = profile;
  const fieldErrors = [];
  const add = (field, code, message) => { if (fieldErrors.length < 20) fieldErrors.push({ field, code, message }); };
  const object = (value, fields, field) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      add(field, 'INVALID_OBJECT', 'Expected an object.');
      return false;
    }
    if (Object.keys(value).some((key) => !fields.includes(key))) add(field, 'UNKNOWN_FIELDS', 'Unexpected fields are not allowed.');
    return true;
  };
  const text = (value, max, field) => {
    if (typeof value !== 'string' || !value.trim()) add(field, 'REQUIRED_TEXT', 'Expected non-empty text.');
    else if ([...value].length > max) add(field, 'TEXT_LIMIT', `Text must not exceed ${max} Unicode code points.`);
  };
  const array = (value, min, max, field) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
      add(field, 'ITEM_COUNT', `Expected ${min === max ? min : `${min}-${max}`} items.`);
      return false;
    }
    return true;
  };
  if (object(content, ['title', 'bullets', 'searchTerms', 'recommendedColors'], 'content')) {
    text(content.title, limits.titleCodePoints, 'title');
    if (array(content.bullets, limits.bulletCount, limits.bulletCount, 'bullets')) {
      content.bullets.forEach((bullet, i) => text(bullet, limits.bulletCodePoints, `bullets[${i}]`));
    }
    if (array(content.searchTerms, limits.searchTerms.min, limits.searchTerms.max, 'searchTerms')) {
      content.searchTerms.forEach((term, i) => text(term, limits.searchTerms.maxUtf8Bytes, `searchTerms[${i}]`));
      if (content.searchTerms.every((term) => typeof term === 'string')) {
        const uniqueTerms = new Set(content.searchTerms.map((term) => term.trim().replace(/\s+/g, ' ').toLowerCase()));
        if (uniqueTerms.size !== content.searchTerms.length) add('searchTerms', 'DUPLICATE_TERM', 'Search terms must be distinct ignoring case and whitespace.');
        if (Buffer.byteLength(content.searchTerms.join(' '), 'utf8') > limits.searchTerms.maxUtf8Bytes) {
          add('searchTerms', 'UTF8_LIMIT', `Joined search terms must not exceed ${limits.searchTerms.maxUtf8Bytes} UTF-8 bytes.`);
        }
      }
    }
    if (array(content.recommendedColors, limits.recommendedColors.min, limits.recommendedColors.max, 'recommendedColors')) {
      const allowedColorCodes = new Set(snapshot.availableColors.map(({ code }) => code));
      const seen = new Set();
      content.recommendedColors.forEach((color, i) => {
        const field = `recommendedColors[${i}]`;
        if (!object(color, ['code', 'reason'], field)) return;
        if (!allowedColorCodes.has(color.code)) add(`${field}.code`, 'COLOR_NOT_ALLOWED', 'Color code must exactly match an allowed color.');
        if (seen.has(color.code)) add('recommendedColors', 'DUPLICATE_COLOR', 'Recommended color codes must be distinct.');
        seen.add(color.code);
        text(color.reason, limits.recommendedColors.reasonCodePoints, `${field}.reason`);
      });
    }
  }
  if (fieldErrors.length) throw new AppError('Content failed validation', 400, true, 'CONTENT_VALIDATION_FAILED', { fieldErrors });
  return { title: content.title, bullets: [...content.bullets], searchTerms: [...content.searchTerms], recommendedColors: content.recommendedColors.map(({ code, reason }) => ({ code, reason })) };
}

module.exports = { validateContent };
