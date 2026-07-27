const { evaluateFullHrReadiness, hasRequiredRouteContracts, readPayrollDifferenceCount } = require('../../../modules/hr/scripts/auditFullHrReadiness');

describe('auditFullHrReadiness', () => {
  test('blocks cutover when any required evidence gate is unresolved', () => {
    expect(evaluateFullHrReadiness({
      identityMissingCount: 1,
      unresolvedAttendanceCount: 2,
      sqlWatermark: null,
      payrollDifferenceCount: 1,
      migrationIdempotent: false,
      permissionsRegistered: false,
      routesRegistered: false,
      parityReady: false,
    })).toEqual({
      ready: false,
      failedGateCodes: [
        'IDENTITY_REFERENCES_MISSING',
        'ATTENDANCE_RECONCILIATION_UNRESOLVED',
        'SQL_WATERMARK_LAGGING',
        'PAYROLL_DIFFERENCES_PRESENT',
        'MIGRATION_NOT_IDEMPOTENT',
        'HR_PERMISSIONS_MISSING',
        'HR_ROUTES_MISSING',
        'LEGACY_PARITY_EVIDENCE_MISSING',
      ],
    });
  });

  test('allows cutover only when every gate has evidence', () => {
    expect(evaluateFullHrReadiness({
      identityMissingCount: 0,
      unresolvedAttendanceCount: 0,
      sqlWatermark: new Date('2026-07-27T00:00:00.000Z'),
      payrollDifferenceCount: 0,
      migrationIdempotent: true,
      permissionsRegistered: true,
      routesRegistered: true,
      parityReady: true,
    })).toEqual({ ready: true, failedGateCodes: [] });
  });

  test('requires each concrete HR, notification, and SQL route contract', () => {
    expect(hasRequiredRouteContracts({
      hr: ['/payrolls', '/announcements', '/holidays', '/saturday-rotations', '/attendance'],
      notification: ['/', '/unread-count', '/read-all', '/:id/read'],
      sqlAttendance: ['/sync', '/status'],
    })).toBe(true);
    expect(hasRequiredRouteContracts({
      hr: ['/payrolls'], notification: ['/', '/unread-count'], sqlAttendance: ['/sync'],
    })).toBe(false);
  });

  test('consumes the safe payroll comparison report instead of salary differences', () => {
    const filePath = require('path').join(require('os').tmpdir(), `hr-safe-report-${process.pid}.json`);
    require('fs').writeFileSync(filePath, JSON.stringify({ differenceCount: 0, gateCodes: [] }));
    expect(readPayrollDifferenceCount(filePath)).toBe(0);
    require('fs').unlinkSync(filePath);
  });
});
