const {
  attendanceSource,
  assertIdentityApplyReady,
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
  planLegacyIdentities,
  reconcileRows,
} = require('../../../modules/hr/scripts/migrateLngHrData');

describe('migrateLngHrData helpers', () => {
  it('parses dry-run and apply arguments', () => {
    expect(parseArgs([])).toEqual({ apply: false, limit: 0 });
    expect(parseArgs(['--apply', '--limit=10'])).toEqual({ apply: true, limit: 10 });
  });

  it('blocks apply before writes when identity preflight has unresolved rows', () => {
    expect(() => assertIdentityApplyReady(true, {
      read: 52,
      mapped: 41,
      skipped: 11,
      failed: 0,
    })).toThrow('Identity migration preflight failed: 11 skipped, 0 failed');
    expect(() => assertIdentityApplyReady(false, { skipped: 11, failed: 0 })).not.toThrow();
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

  it('reports every source row that a mapper omitted without a reason', () => {
    expect(reconcileRows(
      [{ _id: 'one' }, { _id: 'two' }, { _id: 'three' }],
      [{ _id: 'one' }],
      [{ sourceId: 'two', reasonCode: 'KNOWN_SKIP' }],
      'DEPENDENCY_NOT_MAPPED',
    )).toEqual([
      { sourceId: 'two', reasonCode: 'KNOWN_SKIP' },
      { sourceId: 'three', reasonCode: 'DEPENDENCY_NOT_MAPPED' },
    ]);
  });

  it('plans each legacy identity with an explicit least-privilege role decision', () => {
    const sourceAccountId = '660000000000000000000101';
    const employeeId = '660000000000000000000201';
    const departmentId = '660000000000000000000301';
    const teamId = '660000000000000000000401';
    const result = planLegacyIdentities({
      sourceAccounts: [{ _id: sourceAccountId, username: 'legacy-user', role: '660000000000000000000501', isActive: true }],
      sourceRoles: [{ _id: '660000000000000000000501', name: 'LEADER' }],
      sourceEmployees: [{
        _id: employeeId,
        accountId: sourceAccountId,
        employeeCode: 'NV001',
        fullName: 'Legacy Leader',
        workEmail: 'leader@example.com',
        departmentId,
        teamId,
        status: 'Active',
      }],
      sourceTeams: [{ _id: teamId, leader: employeeId }],
      targetAccounts: [],
      departmentBySourceId: new Map([[departmentId, { _id: departmentId }]]),
      teamBySourceId: new Map([[teamId, { _id: teamId }]]),
    });

    expect(result.skippedRows).toEqual([]);
    expect(result.items).toEqual([expect.objectContaining({
      sourceAccountId,
      accountId: sourceAccountId,
      email: 'leader@example.com',
      accountStatus: 'inactive',
      employeeCode: 'NV001',
      departmentId,
      teamId,
      memberType: 'LEADER',
      roleDecision: {
        legacyRole: 'LEADER',
        assignments: [
          { roleCode: 'LEADER', scopeType: 'team', scopeId: teamId, overridePermissionCodes: null },
          { roleCode: 'USER', scopeType: 'team', scopeId: teamId, overridePermissionCodes: null },
        ],
        elevated: false,
      },
    })]);
    expect(result.summary).toEqual({ read: 1, mapped: 1, skipped: 0, activeOrProbationRead: 1, activeOrProbationMapped: 1, activeOrProbationSkipped: 0 });
  });

  it('reports an unmapped role and reconciles the skipped active employee', () => {
    const result = planLegacyIdentities({
      sourceAccounts: [{ _id: 'a1', username: 'unknown', role: 'r1', isActive: true }],
      sourceRoles: [{ _id: 'r1', name: 'CUSTOM_ROLE' }],
      sourceEmployees: [{ _id: 'e1', accountId: 'a1', personalEmail: 'unknown@example.com', status: 'Probation' }],
      sourceTeams: [],
      targetAccounts: [],
      departmentBySourceId: new Map(),
      teamBySourceId: new Map(),
    });

    expect(result.items).toEqual([]);
    expect(result.skippedRows).toEqual([{ sourceId: 'e1', sourceAccountId: 'a1', legacyRole: 'CUSTOM_ROLE', reasonCode: 'UNMAPPED_LEGACY_ROLE' }]);
    expect(result.summary).toEqual({ read: 1, mapped: 0, skipped: 1, activeOrProbationRead: 1, activeOrProbationMapped: 0, activeOrProbationSkipped: 1 });
  });

  it('reuses the account already linked to the same employee code', () => {
    const result = planLegacyIdentities({
      sourceAccounts: [{ _id: 'a1', role: 'r1' }],
      sourceRoles: [{ _id: 'r1', name: 'EMPLOYEE' }],
      sourceEmployees: [{ _id: 'e1', accountId: 'a1', employeeCode: 'NV001', workEmail: 'new@example.com', status: 'Active' }],
      targetAccounts: [{ _id: 'target1', normalizedEmail: 'old@example.com', employeeCode: 'NV001', status: 'active' }],
    });

    expect(result.skippedRows).toEqual([]);
    expect(result.items[0]).toMatchObject({ accountId: 'target1', email: 'old@example.com' });
  });

  it('skips when email and employee code resolve to different target accounts', () => {
    const result = planLegacyIdentities({
      sourceAccounts: [{ _id: 'a1', role: 'r1' }],
      sourceRoles: [{ _id: 'r1', name: 'EMPLOYEE' }],
      sourceEmployees: [{ _id: 'e1', accountId: 'a1', employeeCode: 'NV001', workEmail: 'new@example.com', status: 'Active' }],
      targetAccounts: [
        { _id: 'target1', normalizedEmail: 'new@example.com', employeeCode: 'OTHER' },
        { _id: 'target2', normalizedEmail: 'old@example.com', employeeCode: 'NV001' },
      ],
    });

    expect(result.items).toEqual([]);
    expect(result.skippedRows).toEqual([{ sourceId: 'e1', sourceAccountId: 'a1', legacyRole: 'EMPLOYEE', reasonCode: 'AMBIGUOUS_TARGET_ACCOUNT' }]);
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
