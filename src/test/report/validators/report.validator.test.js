const { baseReportQuerySchema, validate } = require('../../../modules/report/validators/report.validator');

test('base report query preserves seller and team filters', () => {
  const result = validate(baseReportQuerySchema, {
    sellerEmployeeCode: ' j2508 ',
    teamId: '660000000000000000000201',
  });

  expect(result.value).toEqual({
    sellerEmployeeCode: 'J2508',
    teamId: '660000000000000000000201',
  });
});

test('base report query accepts departmentId', () => {
  const result = validate(baseReportQuerySchema, {
    departmentId: '660000000000000000000501',
  });

  expect(result.details).toBeUndefined();
  expect(result.value.departmentId).toBe('660000000000000000000501');
});
