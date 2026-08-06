const EmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');

describe('employee profile model', () => {
  test('keeps the Phase 1 employment and compensation profile fields', () => {
    expect(EmployeeProfile.schema.path('birthDate')).toBeDefined();
    expect(EmployeeProfile.schema.path('emergencyContact.name')).toBeDefined();
    expect(EmployeeProfile.schema.path('contractNumber')).toBeDefined();
    expect(EmployeeProfile.schema.path('dependantDetails')).toBeDefined();
    expect(EmployeeProfile.schema.path('allowances.lunch')).toBeDefined();
    expect(EmployeeProfile.schema.path('baseCurrency')).toBeDefined();
    expect(EmployeeProfile.schema.path('scheduleMutationVersion')).toBeDefined();
    expect(EmployeeProfile.schema.path('scheduleMutationVersion').options.select).toBe(false);
  });
});
