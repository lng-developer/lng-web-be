const fs = require('fs');
const path = require('path');

function loadHrModule() {
  let hr;
  jest.isolateModules(() => {
    hr = require('../../../modules/hr');
  });
  return hr;
}

describe('hr module', () => {
  test('registers the HR router', () => {
    expect(loadHrModule()).toEqual(expect.objectContaining({
      router: expect.any(Function),
      public: expect.any(Object),
    }));
  });

  test('mounts the HR router under /api/hr', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../modules/index.js'), 'utf8');

    expect(source).toContain("router.use('/hr', hr.router);");
  });
});
