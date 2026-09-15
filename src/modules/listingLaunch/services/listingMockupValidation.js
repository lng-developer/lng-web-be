const AppError = require('../../../shared/errors/appError');
const limits = { detectedText: 2000, theme: 300, designDescription: 2000, suggestedKeyword: 200 };
const warnings = ['UNREADABLE_TEXT', 'LOW_DETAIL', 'AMBIGUOUS_DESIGN', 'NO_CLEAR_DESIGN'];
function validateMockupAnalysis(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => ![...Object.keys(limits), 'warnings'].includes(k))) errors.push({ field: 'result', code: 'INVALID_OBJECT' });
  for (const [field, max] of Object.entries(limits)) if (typeof value?.[field] !== 'string' || [...value[field]].length > max) errors.push({ field, code: 'TEXT_LIMIT' });
  if (!Array.isArray(value?.warnings) || value.warnings.length > 10 || value.warnings.some(w => !warnings.includes(w))) errors.push({ field: 'warnings', code: 'INVALID_ENUM' });
  if (errors.length) throw new AppError('Mockup analysis failed validation', 502, true, 'MOCKUP_VALIDATION_FAILED', { fieldErrors: errors.map(x => ({ ...x, message: 'Analysis field failed validation' })) });
  return { detectedText: value.detectedText, theme: value.theme, designDescription: value.designDescription, suggestedKeyword: value.suggestedKeyword, warnings: [...value.warnings] };
}
module.exports = { validateMockupAnalysis, limits, warnings };
