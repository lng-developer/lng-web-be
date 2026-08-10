const { validate, workspaceQuerySchema } = require('../../../src/modules/hr/validators/workspace.validator');

test('accepts only supported team analytics ranges', () => {
  expect(validate(workspaceQuerySchema, {
    dateKey: '2026-08-09', year: 2026, month: 8, days: 7,
  })).toEqual({ value: { dateKey: '2026-08-09', year: 2026, month: 8, days: 7 } });
  expect(validate(workspaceQuerySchema, {
    dateKey: '2026-08-09', year: 2026, month: 8, days: 14,
  }).details).toBeDefined();
});
