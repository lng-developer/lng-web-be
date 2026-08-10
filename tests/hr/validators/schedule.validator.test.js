const {
  createShiftSchema,
  validate,
} = require('../../../src/modules/hr/validators/schedule.validator');

describe('schedule validator', () => {
  test('rejects invalid shift times and a shift longer than sixteen hours', () => {
    const invalidTime = validate(createShiftSchema, {
      code: 'N1',
      name: 'Night',
      startTime: '25:00',
      endTime: '08:00',
    });
    const excessiveDuration = validate(createShiftSchema, {
      code: 'N2',
      name: 'Extended',
      startTime: '08:00',
      endTime: '00:01',
    });

    expect(invalidTime.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['startTime'] }),
    ]));
    expect(excessiveDuration.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['endTime'] }),
    ]));
  });

  test('rejects a break equal to the whole shift duration', () => {
    const result = validate(createShiftSchema, {
      code: 'DAY', name: 'Day', startTime: '08:00', endTime: '17:00', breakMinutes: 540,
    });

    expect(result.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['breakMinutes'] }),
    ]));
  });
});
