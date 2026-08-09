const { buildCollection } = require('../../../scripts/apiContract/buildHrPostmanCollection');

function requests(collection) {
  return collection.item.flatMap((folder) => folder.item);
}

describe('HR Postman collection', () => {
  test('covers every registered HR route with usable mutation examples', () => {
    const items = requests(buildCollection());
    expect(items).toHaveLength(99);
    expect(new Set(items.map(({ name }) => name)).size).toBe(99);

    const checkIn = items.find(({ name }) => name === 'POST /api/hr/attendance/check-in');
    expect(JSON.parse(checkIn.request.body.raw)).toEqual({ occurredAt: '2026-08-06T01:00:00.000Z' });

    const avatar = items.find(({ name }) => name === 'POST /api/hr/employee-profiles/me/avatar');
    expect(avatar.request.body.mode).toBe('formdata');
    expect(avatar.request.body.formdata[0]).toMatchObject({ key: 'file', type: 'file' });

    const settings = items.find(({ name }) => name === 'PUT /api/hr/payroll-settings');
    expect(JSON.parse(settings.request.body.raw)).toMatchObject({ expectedVersion: 0, workHoursPerDay: 8 });
  });
});
