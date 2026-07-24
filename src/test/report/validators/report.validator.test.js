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
