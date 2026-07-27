const legacyParityCatalog = [
  { id: 'employees', sourceRoutes: ['/api/employees'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['employee route contract', 'migration counts'] },
  { id: 'shifts', sourceRoutes: ['/api/shifts'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['shift route contract'] },
  { id: 'holidays', sourceRoutes: ['/api/holidays'], sourceJobs: ['holiday attendance repair'], targetOwner: 'hr', disposition: 'replace', evidence: ['holiday precedence cases'] },
  { id: 'saturday-rotations', sourceRoutes: ['/api/saturday-rotations'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['rotation schedule cases'] },
  { id: 'attendance', sourceRoutes: ['/api/attendances'], sourceJobs: ['reconciliation'], targetOwner: 'hr', disposition: 'replace', evidence: ['legacyAttendanceResolutionCases'] },
  { id: 'sql-attendance-worker', sourceRoutes: ['/api/sql-server'], sourceJobs: ['sql-attendance-worker'], targetOwner: 'integration', disposition: 'replace', evidence: ['cursor and idempotency tests'] },
  { id: 'leaves', sourceRoutes: ['/api/leaves'], sourceJobs: ['leave attendance sync'], targetOwner: 'hr', disposition: 'replace', evidence: ['leave lifecycle cases'] },
  { id: 'leave-balances', sourceRoutes: ['/api/leave-balances'], sourceJobs: ['accrual', 'reset', 'carry-over'], targetOwner: 'hr', disposition: 'replace', evidence: ['balance lifecycle cases'] },
  { id: 'overtime', sourceRoutes: ['/api/overtimes'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['overtime lifecycle cases'] },
  { id: 'payroll', sourceRoutes: ['/api/payrolls'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['per-employee shadow diff'] },
  { id: 'payroll-adjustments', sourceRoutes: ['/api/payroll-adjustments'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['adjustment lifecycle cases'] },
  { id: 'payroll-email', sourceRoutes: [], sourceJobs: ['payroll email worker'], targetOwner: 'hr', disposition: 'replace', evidence: ['deduplicated email job tests'] },
  { id: 'notifications', sourceRoutes: ['/api/notifications'], sourceJobs: [], targetOwner: 'notification', disposition: 'replace', evidence: ['inbox and retry tests'] },
  { id: 'announcements', sourceRoutes: ['/api/announcements'], sourceJobs: ['announcement publish and reminder'], targetOwner: 'hr', disposition: 'replace', evidence: ['visibility and recipient tests'] },
  { id: 'dashboard', sourceRoutes: ['/api/dashboard'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['DTO aggregate tests'] },
  { id: 'office-networks', sourceRoutes: ['/api/office-networks'], sourceJobs: [], targetOwner: 'integration', disposition: 'replace', evidence: ['trusted network validation tests'] },
  { id: 'system-settings', sourceRoutes: ['/api/system-settings'], sourceJobs: [], targetOwner: 'hr', disposition: 'replace', evidence: ['explicit setting mapping'] },
];

function assertLegacyParityCatalog(catalog = legacyParityCatalog) {
  const ids = catalog.map(({ id }) => id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const missingEvidenceIds = catalog
    .filter((entry) => !entry.disposition || !entry.evidence?.length)
    .map(({ id }) => id);

  return {
    ready: !duplicateIds.length && !missingEvidenceIds.length,
    missingEvidenceIds,
    duplicateIds,
  };
}

module.exports = { legacyParityCatalog, assertLegacyParityCatalog };
