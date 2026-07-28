const { assertLegacyParityCatalog } = require('../../../modules/hr/scripts/legacyParityCatalog');

test('readiness audit blocks migration when a legacy domain lacks parity evidence', () => {
  expect(assertLegacyParityCatalog([
    { id: 'attendance', disposition: 'replace', evidence: ['resolver cases'] },
    { id: 'payroll', disposition: 'replace', evidence: [] },
    { id: 'payroll', disposition: 'replace', evidence: ['shadow diff'] },
  ])).toEqual({
    ready: false,
    missingEvidenceIds: ['payroll'],
    duplicateIds: ['payroll'],
  });
});
