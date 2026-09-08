const { baseReportQuerySchema, financeReportQuerySchema, validate } = require('../../../src/modules/report/validators/report.validator');

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

test('finance report query defaults to order date and only accepts known date bases', () => {
  expect(validate(financeReportQuerySchema, {}).value.dateBasis).toBe('ORDERED_AT');
  expect(validate(financeReportQuerySchema, { dateBasis: 'calculated_at' }).value.dateBasis).toBe('CALCULATED_AT');
  expect(validate(financeReportQuerySchema, { dateBasis: 'created_at' }).details).toEqual(expect.any(Array));
});
