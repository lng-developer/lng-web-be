const {
  staffProvisioningSchema,
  validate,
} = require('../../../modules/hr/validators/staffProvisioning.validator');

test('keeps HR compensation fields when provisioning staff', () => {
  const { value, details } = validate(staffProvisioningSchema, {
    employeeCode: 'J2501',
    workEmail: 'hoang@lng.co',
    fullName: 'Nguyen Huy Hoang',
    employmentType: 'FULL_TIME',
    workMode: 'ONSITE',
    startDate: '2026-07-01',
    status: 'ACTIVE',
    baseCurrency: 'VND',
    baseSalary: 15000000,
    assignments: [{
      roleId: '660000000000000000000001',
      scopeType: 'global',
      scopeId: null,
    }],
  });

  expect(details).toBeUndefined();
  expect(value).toMatchObject({ baseCurrency: 'VND', baseSalary: 15000000 });
});

test('requires only identity and initial access when provisioning staff', () => {
  const { value, details } = validate(staffProvisioningSchema, {
    employeeCode: 'J2502',
    workEmail: 'trung@lng.co',
    fullName: 'Dang Thanh Trung',
    assignments: [{
      roleId: '660000000000000000000001',
      scopeType: 'global',
      scopeId: null,
    }],
  });

  expect(details).toBeUndefined();
  expect(value).toMatchObject({
    employmentType: 'FULL_TIME',
    workMode: 'ONSITE',
    status: 'PROBATION',
    baseCurrency: 'VND',
    baseSalary: 0,
  });
  expect(value.startDate).toBeInstanceOf(Date);
});
