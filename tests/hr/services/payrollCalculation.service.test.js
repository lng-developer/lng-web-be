const { calculatePayrollResult, FORMULA_VERSION } = require('../../../src/modules/hr/services/payrollCalculation.service');
const { DEFAULT_PAYROLL_SETTINGS } = require('../../../src/modules/hr/services/payrollConfig.service');

const DAY = 10000;

function profile(overrides = {}) {
  return {
    _id: '671000000000000000000001',
    accountId: '671000000000000000000002',
    employeeCode: 'PAY-001',
    fullName: 'Payroll Fixture',
    status: 'ACTIVE',
    startDate: new Date('2026-07-01T00:00:00.000Z'),
    endDate: null,
    baseSalary: 22000000,
    allowances: { lunch: 0, fuel: 0, other: 0 },
    responsibilityAllowance: 0,
    dependants: 0,
    ...overrides,
  };
}

function attendanceDays(count, start = 1) {
  return Array.from({ length: count }, (_, index) => ({
    workDateKey: `2026-07-${String(start + index).padStart(2, '0')}`,
    status: 'PRESENT',
    workDayValue: 1,
  }));
}

function calculate(overrides = {}) {
  return calculatePayrollResult({
    month: 7,
    year: 2026,
    profile: profile(),
    standardWorkDays: 22,
    attendance: attendanceDays(22),
    approvedLeave: [],
    approvedOvertime: [],
    holidays: [],
    adjustments: [],
    ...overrides,
  });
}

describe('payroll calculation parity', () => {
  test.each([
    ['regular employee', {}, {
      workUnits: 22 * DAY, salaryFromWork: 22000000, grossIncome: 22000000,
      totalDeductions: 2929000, netIncome: 19071000,
    }],
    ['mid-month start', {
      profile: profile({ startDate: new Date('2026-07-12T00:00:00.000Z') }),
      attendance: attendanceDays(11, 12),
    }, {
      workUnits: 11 * DAY, salaryFromWork: 11000000, grossIncome: 11000000,
      totalDeductions: 2310000, netIncome: 8690000,
    }],
    ['unpaid leave', {
      attendance: attendanceDays(21),
      approvedLeave: [{
        _id: '672000000000000000000001',
        leaveType: 'UNPAID',
        workingDateSnapshots: [{ dateKey: '2026-07-22', units: 2 }],
      }],
    }, {
      workUnits: 21 * DAY, salaryFromWork: 21000000, grossIncome: 21000000,
      totalDeductions: 2829000, netIncome: 18171000,
    }],
    ['approved paid leave without attendance row', {
      attendance: attendanceDays(21),
      approvedLeave: [{
        _id: '672000000000000000000002',
        leaveType: 'ANNUAL',
        workingDateSnapshots: [{ dateKey: '2026-07-22', units: 2 }],
      }],
    }, {
      workUnits: 22 * DAY, salaryFromWork: 22000000, grossIncome: 22000000,
      totalDeductions: 2929000, netIncome: 19071000,
    }],
    ['paid holiday without attendance row', {
      attendance: attendanceDays(21),
      holidays: [{ dateKey: '2026-07-22', holidayType: 'PUBLIC_HOLIDAY', isWorkDay: false }],
    }, {
      workUnits: 22 * DAY, salaryFromWork: 22000000, grossIncome: 22000000,
      totalDeductions: 2929000, netIncome: 19071000,
    }],
    ['approved weekday overtime', {
      approvedOvertime: [{
        _id: '673000000000000000000001', workDateKey: '2026-07-22', approvedMinutes: 120, calendarClass: 'WORKDAY',
        plannedStartAt: new Date('2026-07-22T11:00:00.000Z'),
        plannedEndAt: new Date('2026-07-22T13:00:00.000Z'),
        scheduleSnapshot: { timezone: 'Asia/Ho_Chi_Minh' },
      }],
    }, {
      workUnits: 22 * DAY, salaryFromWork: 22000000, overtimePay: 375000,
      grossIncome: 22375000, totalDeductions: 2966500, netIncome: 19408500,
    }],
    ['fixed allowances', {
      profile: profile({
        allowances: { lunch: 500000, fuel: 200000, other: 100000 }, responsibilityAllowance: 300000,
      }),
    }, {
      workUnits: 22 * DAY, totalAllowances: 1100000, grossIncome: 23100000,
      totalDeductions: 3039000, netIncome: 20061000,
    }],
    ['approved earnings and deduction adjustments', {
      adjustments: [
        { _id: '674000000000000000000001', type: 'EARNING', code: 'BONUS', name: 'Bonus', amount: 500000, status: 'APPROVED' },
        { _id: '674000000000000000000002', type: 'DEDUCTION', code: 'ADVANCE', name: 'Advance', amount: 200000, status: 'APPROVED' },
      ],
    }, {
      workUnits: 22 * DAY, adjustmentEarnings: 500000, adjustmentDeductions: 200000,
      grossIncome: 22500000, totalDeductions: 3179000, netIncome: 19321000,
    }],
    ['integer rounding', {
      profile: profile({ baseSalary: 1000000 }),
      standardWorkDays: 3,
      attendance: attendanceDays(1),
    }, {
      workUnits: DAY, salaryFromWork: 333333, grossIncome: 333333,
      totalDeductions: 105000, netIncome: 228333,
    }],
  ])('calculates exact integer VND for %s', (_name, input, expected) => {
    const result = calculate(input);

    expect(result).toMatchObject(expected);
    for (const field of [
      'salaryFromWork', 'overtimePay', 'totalAllowances', 'adjustmentEarnings',
      'adjustmentDeductions', 'grossIncome', 'totalDeductions', 'netIncome',
    ]) expect(Number.isInteger(result[field])).toBe(true);
  });

  test('freezes the exact normalized inputs and formula version used for the result', () => {
    const result = calculate({
      approvedOvertime: [{
        _id: '673000000000000000000001', workDateKey: '2026-07-22', approvedMinutes: 30, calendarClass: 'HOLIDAY',
        plannedStartAt: new Date('2026-07-22T11:30:00.000Z'),
        plannedEndAt: new Date('2026-07-22T12:00:00.000Z'),
        scheduleSnapshot: { timezone: 'Asia/Ho_Chi_Minh' },
      }],
    });

    expect(result.formulaVersion).toBe(FORMULA_VERSION);
    expect(result.inputSnapshot).toEqual(expect.objectContaining({
      formulaVersion: FORMULA_VERSION,
      period: { month: 7, year: 2026 },
      compensation: expect.objectContaining({ baseSalary: 22000000, currency: 'VND' }),
      attendance: expect.objectContaining({ standardWorkDays: 22, workUnits: 220000 }),
      overtime: [expect.objectContaining({
        requestId: '673000000000000000000001', workDateKey: '2026-07-22', approvedMinutes: 30,
        calendarClass: 'HOLIDAY', allocationSource: 'COMPATIBILITY_DERIVED',
      })],
    }));
    expect(Object.isFrozen(result.inputSnapshot)).toBe(true);
  });

  test('uses and snapshots the supplied payroll settings', () => {
    const settings = {
      ...DEFAULT_PAYROLL_SETTINGS,
      formulaVersion: 'custom-v2',
      insuranceRates: { social: 0, health: 0, unemployment: 0 },
      company: { name: 'LNG Group', currency: 'VND' },
      version: 3,
    };

    const result = calculatePayrollResult({
      month: 7,
      year: 2026,
      profile: profile(),
      standardWorkDays: 22,
      attendance: attendanceDays(22),
    }, settings);

    expect(result).toMatchObject({
      formulaVersion: 'custom-v2',
      insurance: { total: 0 },
      netIncome: 21100000,
    });
    expect(result.inputSnapshot.payrollSettings).toEqual(settings);
  });

  test('weights a mid-period probation transition for salary and insurance', () => {
    const attendance = [];
    for (let day = 1; day <= 31; day += 1) {
      const date = new Date(Date.UTC(2026, 6, day));
      if (date.getUTCDay() !== 0) attendance.push({
        workDateKey: date.toISOString().slice(0, 10), status: 'PRESENT', workDayValue: 1,
      });
    }

    const result = calculate({
      profile: profile({ baseSalary: 27000000, probationEndDate: new Date('2026-07-12T00:00:00.000Z') }),
      standardWorkDays: 27,
      attendance,
    });

    expect(result).toMatchObject({
      workUnits: 270000,
      salaryFromWork: 25500000,
      insurance: { social: 2040000, health: 382500, unemployment: 255000, total: 2677500 },
      grossIncome: 25500000,
      totalDeductions: 3700875,
      netIncome: 21799125,
    });
  });

  test('prices an approved interval crossing 22:00 with separate weekday day/night rates', () => {
    const result = calculate({
      approvedOvertime: [{
        _id: '673000000000000000000009',
        workDateKey: '2026-07-22',
        approvedMinutes: 60,
        calendarClass: 'WORKDAY',
        plannedStartAt: new Date('2026-07-22T14:30:00.000Z'),
        plannedEndAt: new Date('2026-07-22T15:30:00.000Z'),
        scheduleSnapshot: { timezone: 'Asia/Ho_Chi_Minh' },
      }],
    });

    expect(result.overtimePay).toBe(206250);
    expect(result.overtimeBreakdown).toEqual(expect.arrayContaining([
      { rateClass: 'weekday', approvedMinutes: 30, rateBasisPoints: 15000, amount: 93750 },
      { rateClass: 'weekday_night', approvedMinutes: 30, rateBasisPoints: 18000, amount: 112500 },
    ]));
    expect(result.inputSnapshot.overtime).toEqual([expect.objectContaining({
      allocationSource: 'COMPATIBILITY_DERIVED',
      approvedRateMinutes: {
        weekday: 30, weekend: 0, holiday: 0,
        weekday_night: 30, weekend_night: 0, holiday_night: 0,
      },
    })]);
  });

  test.each([
    ['weekday', 'WORKDAY', 15000, 187500],
    ['weekday_night', 'WORKDAY', 18000, 225000],
    ['weekend', 'REST_DAY', 20000, 250000],
    ['weekend_night', 'REST_DAY', 24000, 300000],
    ['holiday', 'HOLIDAY', 30000, 375000],
    ['holiday_night', 'HOLIDAY', 39000, 487500],
  ])('prices stored %s minutes with the legacy multiplier', (
    rateClass, calendarClass, rateBasisPoints, expectedAmount,
  ) => {
    const approvedRateMinutes = {
      weekday: 0, weekend: 0, holiday: 0,
      weekday_night: 0, weekend_night: 0, holiday_night: 0,
      [rateClass]: 60,
    };
    const result = calculate({
      approvedOvertime: [{
        _id: `stored-${rateClass}`,
        workDateKey: '2026-07-22',
        approvedMinutes: 60,
        calendarClass,
        plannedStartAt: new Date('2026-07-22T11:00:00.000Z'),
        plannedEndAt: new Date('2026-07-22T12:00:00.000Z'),
        scheduleSnapshot: { timezone: 'Asia/Ho_Chi_Minh' },
        approvedRateMinutes,
      }],
    });

    expect(result.overtimePay).toBe(expectedAmount);
    expect(result.overtimeBreakdown).toContainEqual({
      rateClass, approvedMinutes: 60, rateBasisPoints, amount: expectedAmount,
    });
    expect(result.inputSnapshot.overtime[0]).toMatchObject({
      allocationSource: 'STORED', approvedRateMinutes,
    });
  });
});
