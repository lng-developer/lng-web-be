const {
  staffProvisioningSchema,
  validate,
} = require('../../../src/modules/hr/validators/staffProvisioning.validator');

test('keeps HR compensation fields when provisioning staff', () => {
  const { value, details } = validate(staffProvisioningSchema, {
    employeeCode: 'J2501',
    workEmail: 'hoang@lng.co',
    fullName: 'Nguyen Huy Hoang',
    employmentType: 'FULL_TIME',
    workMode: 'ONSITE',
    startDate: '2026-07-01',
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

test('rejects caller-controlled status', () => {
  const { details } = validate(staffProvisioningSchema, {
    employeeCode: 'J2501',
    workEmail: 'hoang@lng.co',
    fullName: 'Nguyen Huy Hoang',
    status: 'ACTIVE',
    assignments: [{
      roleId: '660000000000000000000001', scopeType: 'global', scopeId: null,
    }],
  });

  expect(details).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: ['status'], type: 'any.unknown' }),
  ]));
});

test('rejects probation ending before employment starts', () => {
  const { details } = validate(staffProvisioningSchema, {
    employeeCode: 'J2501',
    workEmail: 'hoang@lng.co',
    fullName: 'Nguyen Huy Hoang',
    startDate: '2026-07-10',
    probationEndDate: '2026-07-09',
    assignments: [{
      roleId: '660000000000000000000001', scopeType: 'global', scopeId: null,
    }],
  });

  expect(details).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: ['probationEndDate'] }),
  ]));
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
    baseCurrency: 'VND',
    baseSalary: 0,
  });
  expect(value.startDate).toBeInstanceOf(Date);
  expect(value).not.toHaveProperty('status');
});
