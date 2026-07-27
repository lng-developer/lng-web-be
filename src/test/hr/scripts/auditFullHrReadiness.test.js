const { evaluateFullHrReadiness, hasRequiredRouteContracts, readPayrollDifferenceCount } = require('../../../modules/hr/scripts/auditFullHrReadiness');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

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

  test('runbooks preserve explicit apply and first-write rollback gates', () => {
    const shadow = read('docs/hr/runbooks/shadow-payroll.md');
    const cutover = read('docs/hr/runbooks/hr-cutover.md');
    const rollback = read('docs/hr/runbooks/hr-rollback.md');

    expect(shadow).toContain('npm run migrate:hr:lng-hr');
    expect(shadow).toContain('npm run migrate:hr:lng-hr -- --apply');
    expect(shadow).toContain('npm run compare:hr:payroll --');
    expect(cutover).toContain('npm run audit:hr:readiness --');
    expect(cutover).toContain('FIRST_POD_PRODUCTION_HR_WRITE');
    expect(rollback).toContain('FIRST_POD_PRODUCTION_HR_WRITE');
    expect(rollback).toContain('forward-only');
    expect(rollback).toContain("--nsFrom='lng_hr.*'");
    expect(rollback).toContain('--nsTo="$ValidationDb.*"');
    expect(rollback).not.toContain('mongorestore --uri="$ValidationUri" --gzip --drop');
  });

  test('example and compose expose only implemented HR worker controls', () => {
    const env = read('.env.example');
    const compose = read('docker-compose.yml');
    const cutover = read('docs/hr/runbooks/hr-cutover.md');

    for (const line of [
      'SOURCE_MONGODB_URI=',
      'DB_SERVER=',
      'DB_DATABASE=',
      'DB_PORT=1433',
      'DB_USER=',
      'DB_PASSWORD=',
      'DB_ATTENDANCE_EVENT_ID_COLUMN=',
      'HR_PAYROLL_EMAIL_CONCURRENCY=1',
      'HR_PAYROLL_EMAIL_DELAY_MS=600',
    ]) expect(env).toContain(line);

    expect(env).not.toContain('HR_PAYROLL_DELIVERY_SUPPRESSED');
    expect(compose).toContain('healthcheck:');
    expect(compose).not.toContain('payroll-email-worker:');
    expect(cutover).toContain("-ArgumentList 'run','worker:sql-attendance'");
    expect(cutover).toContain("-ArgumentList 'run','worker:hr-announcements'");
  });
});
