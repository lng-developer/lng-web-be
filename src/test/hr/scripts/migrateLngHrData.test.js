const {
  attendanceSource,
  dateKey,
  normalizeAttendanceStatus,
  normalizeEmployeeStatus,
  normalizeEmploymentType,
  normalizeLeaveType,
  normalizeRequestStatus,
  normalizeWorkMode,
  parseArgs,
  requestedUnits,
  summarizeBulkWrite,
  upsertMany,
  legacyFactDate,
  mapLegacyTeams,
} = require('../../../modules/hr/scripts/migrateLngHrData');

describe('migrateLngHrData helpers', () => {
  it('parses dry-run and apply arguments', () => {
    expect(parseArgs([])).toEqual({ apply: false, limit: 0 });
    expect(parseArgs(['--apply', '--limit=10'])).toEqual({ apply: true, limit: 10 });
  });

  it('reports the second idempotent upsert pass as unchanged without duplicate failures', () => {
    expect(summarizeBulkWrite({ matchedCount: 2, modifiedCount: 0, upsertedCount: 0 }, 2)).toEqual({
      read: 2,
      mapped: 2,
      inserted: 0,
      updated: 0,
      unchanged: 2,
      skipped: 0,
      failed: 0,
      skippedRows: [],
    });
  });

  it('keeps a second migration adapter pass unchanged without a duplicate-key failure', async () => {
    const rows = new Map();
    const Model = {
      async bulkWrite(operations) {
        let matchedCount = 0;
        let modifiedCount = 0;
        let upsertedCount = 0;
        for (const { updateOne } of operations) {
          const key = updateOne.filter.code;
          const next = updateOne.update.$set;
          if (!rows.has(key)) {
            rows.set(key, next);
            upsertedCount += 1;
          } else {
            matchedCount += 1;
            if (JSON.stringify(rows.get(key)) !== JSON.stringify(next)) {
              rows.set(key, next);
              modifiedCount += 1;
            }
          }
        }
        return { matchedCount, modifiedCount, upsertedCount };
      },
    };
    const docs = [{ code: 'HOLIDAY_2026_01_01', name: 'New Year' }];

    await expect(upsertMany(Model, docs, (doc) => ({ code: doc.code }), true)).resolves.toMatchObject({ inserted: 1, failed: 0 });
    await expect(upsertMany(Model, docs, (doc) => ({ code: doc.code }), true)).resolves.toMatchObject({ inserted: 0, unchanged: 1, failed: 0 });
  });

  it('uses a stable legacy epoch when a persisted legacy fact has no timestamp', () => {
    expect(legacyFactDate(null, undefined).toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(legacyFactDate(null, undefined)).toEqual(legacyFactDate(null, undefined));
  });

  it('accounts for every team rejected because its legacy department is missing', () => {
    expect(mapLegacyTeams([{ _id: 't1', departmentId: 'missing', name: 'Broken' }], new Map()))
      .toEqual({ items: [], skippedRows: [{ sourceId: 't1', reasonCode: 'MISSING_OR_UNMAPPED_DEPARTMENT' }] });
  });

  it('normalizes legacy employee enum values', () => {
    expect(normalizeEmployeeStatus('Active')).toBe('ACTIVE');
    expect(normalizeEmployeeStatus('Probation')).toBe('PROBATION');
    expect(normalizeEmployeeStatus('Resigned')).toBe('RESIGNED');
    expect(normalizeEmploymentType('Full-time')).toBe('FULL_TIME');
    expect(normalizeWorkMode('Onsite')).toBe('ONSITE');
  });

  it('normalizes legacy request and attendance enum values', () => {
    expect(normalizeRequestStatus('APPROVED')).toBe('APPROVED');
    expect(normalizeRequestStatus('weird')).toBe('PENDING');
    expect(normalizeLeaveType('SICK')).toBe('SICK');
    expect(normalizeLeaveType('weird')).toBe('ANNUAL');
    expect(normalizeAttendanceStatus('SICK_LEAVE')).toBe('SICK_LEAVE');
    expect(normalizeAttendanceStatus('MATERNITY_LEAVE')).toBe('MATERNITY_LEAVE');
    expect(normalizeAttendanceStatus('PATERNITY_LEAVE')).toBe('PATERNITY_LEAVE');
    expect(normalizeAttendanceStatus('ERROR')).toBe('ERROR');
    expect(attendanceSource('WEB_APP')).toBe('SELF_SERVICE');
    expect(attendanceSource('MACHINE')).toBe('MANAGED');
  });

  it('converts dates and leave units', () => {
    expect(dateKey(new Date('2026-07-16T10:00:00.000Z'))).toBe('2026-07-16');
    expect(dateKey('not-a-date')).toBeNull();
    expect(requestedUnits(0.5)).toBe(1);
    expect(requestedUnits(2)).toBe(4);
  });
});
