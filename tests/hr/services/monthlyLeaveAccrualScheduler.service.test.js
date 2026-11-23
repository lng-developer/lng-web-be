jest.mock('../../../src/modules/hr/services/leave.service', () => ({
  accrueBalances: jest.fn(),
}));

jest.mock('../../../src/shared/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
}));

describe('monthlyLeaveAccrualScheduler.service', () => {
  let scheduler;
  let leaveService;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    leaveService = require('../../../src/modules/hr/services/leave.service');
    scheduler = require('../../../src/modules/hr/services/monthlyLeaveAccrualScheduler.service');
  });

  afterEach(() => {
    scheduler.stopMonthlyLeaveAccrualScheduler();
  });

  test('runOnce accrues 1 day (2 units) for all active profiles with system context', async () => {
    leaveService.accrueBalances.mockResolvedValueOnce({
      processed: 5,
      changed: 5,
      items: [{ id: 'b1' }],
    });

    const result = await scheduler.runOnce({ year: 2026, month: 11 });

    expect(result).toEqual({ processed: 5, changed: 5, items: [{ id: 'b1' }] });
    expect(leaveService.accrueBalances).toHaveBeenCalledWith(
      expect.objectContaining({
        year: 2026,
        month: 11,
        units: 2,
        reason: expect.stringContaining('Tự động cộng 1 ngày phép định kỳ tháng 11/2026'),
      }),
      expect.objectContaining({
        system: true,
        source: 'MONTHLY_LEAVE_ACCRUAL_SCHEDULER',
      }),
    );
  });

  test('start and stop manages scheduler lifecycle without duplicate timers', () => {
    const timer1 = scheduler.startMonthlyLeaveAccrualScheduler();
    const timer2 = scheduler.startMonthlyLeaveAccrualScheduler();
    expect(timer1).toBe(timer2);

    scheduler.stopMonthlyLeaveAccrualScheduler();
    scheduler.stopMonthlyLeaveAccrualScheduler();
  });

  test('getCurrentVietnamMonthYear returns numeric year and month', () => {
    const { year, month } = scheduler.getCurrentVietnamMonthYear();
    expect(typeof year).toBe('number');
    expect(year).toBeGreaterThanOrEqual(2026);
    expect(typeof month).toBe('number');
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });
});
