const fs = require('fs');
const path = require('path');

describe('audit HR profile readiness script', () => {
  test('is explicitly read-only', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../src/modules/hr/scripts/auditHrProfileReadiness.js'),
      'utf8',
    );

    expect(source).toContain('HR profile readiness audit');
    expect(source).not.toContain('deleteMany');
    expect(source).not.toContain('dropDatabase');
  });
});
