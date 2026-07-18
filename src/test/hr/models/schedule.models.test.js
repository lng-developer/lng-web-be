const { hrCalendarOverrideKinds, hrEmployeeStatuses } = require('../../../modules/hr/constants/hr.constants');

const WorkLocation = require('../../../modules/hr/models/workLocation.model');
const Shift = require('../../../modules/hr/models/shift.model');
const ShiftAssignment = require('../../../modules/hr/models/shiftAssignment.model');
const CalendarOverride = require('../../../modules/hr/models/calendarOverride.model');

describe('HR schedule models', () => {
  test('defines the work location, shift, and assignment persistence fields', () => {
    expect(WorkLocation.schema.path('code').options).toMatchObject({ required: true, unique: true, uppercase: true });
    expect(WorkLocation.schema.path('timezone').options).toMatchObject({ required: true });
    expect(WorkLocation.schema.path('status').options).toMatchObject({
      default: hrEmployeeStatuses.ACTIVE,
      enum: expect.arrayContaining([hrEmployeeStatuses.ACTIVE]),
    });

    expect(Shift.schema.path('workLocationId')).toBeDefined();
    expect(Shift.schema.path('startTime').options).toMatchObject({ required: true });
    expect(Shift.schema.path('endTime').options).toMatchObject({ required: true });
    expect(Shift.schema.path('workdays')).toBeDefined();

    expect(ShiftAssignment.schema.path('profileId').options).toMatchObject({ required: true });
    expect(ShiftAssignment.schema.path('effectiveFrom').options).toMatchObject({ required: true });
    expect(ShiftAssignment.schema.path('effectiveTo').options).toMatchObject({ default: null });
  });

  test('has one active calendar override per local date and scope', () => {
    expect(CalendarOverride.schema.path('kind').options.enum).toEqual(
      expect.arrayContaining(Object.values(hrCalendarOverrideKinds)),
    );
    expect(CalendarOverride.schema.indexes()).toContainEqual([
      { dateKey: 1, scopeType: 1, scopeId: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { status: hrEmployeeStatuses.ACTIVE },
      }),
    ]);
  });
});
