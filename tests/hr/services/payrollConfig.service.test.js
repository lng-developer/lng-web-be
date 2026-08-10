jest.mock('../../../src/modules/hr/models/payrollSettings.model', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

const PayrollSettings = require('../../../src/modules/hr/models/payrollSettings.model');
const {
  DEFAULT_PAYROLL_SETTINGS,
  getPayrollSettings,
  updatePayrollSettings,
} = require('../../../src/modules/hr/services/payrollConfig.service');

describe('payroll config service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns defaults when the singleton has not been created', async () => {
    PayrollSettings.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await expect(getPayrollSettings()).resolves.toMatchObject({
      ...DEFAULT_PAYROLL_SETTINGS,
      version: 0,
    });
  });

  test('updates the singleton only at the expected version', async () => {
    const updated = {
      settings: { ...DEFAULT_PAYROLL_SETTINGS, workHoursPerDay: 7 },
      version: 2,
      updatedAt: new Date('2026-08-09T00:00:00.000Z'),
    };
    PayrollSettings.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
      settings: { ...DEFAULT_PAYROLL_SETTINGS, personalDeduction: 12000000 }, version: 1,
    }) });
    PayrollSettings.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(updated) });

    await expect(updatePayrollSettings({
      workHoursPerDay: 7,
      expectedVersion: 1,
    }, { accountId: '671000000000000000000001' })).resolves.toMatchObject({
      workHoursPerDay: 7,
      version: 2,
    });
    expect(PayrollSettings.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'default', version: 1 },
      expect.objectContaining({ $set: expect.objectContaining({ settings: expect.any(Object) }), $inc: { version: 1 } }),
      expect.objectContaining({ returnDocument: 'after', upsert: true }),
    );
    expect(PayrollSettings.findOneAndUpdate.mock.calls[0][1].$set.settings.personalDeduction).toBe(12000000);
  });
});
