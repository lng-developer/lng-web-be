const fs = require('fs');
const path = require('path');

const modulesRoot = path.resolve(__dirname, '..', 'modules');
const moduleNames = [
  'integration',
  'catalog',
  'order',
  'production',
  'finance',
  'media',
  'mapping',
  'shipment',
  'auth',
  'audit',
  'report',
  'vendorSubmission',
];

const requiredModuleEntries = [
  'controllers',
  'services',
  'repositories',
  'models',
  'routes',
  'dtos',
  'public.js',
  'index.js',
];

function collectJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectJavaScriptFiles(fullPath);
    }

    return entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

describe('strict modular monolith architecture', () => {
  test.each(moduleNames)('%s module exposes the required structure', (moduleName) => {
    const modulePath = path.join(modulesRoot, moduleName);

    expect(fs.existsSync(modulePath)).toBe(true);

    requiredModuleEntries.forEach((entry) => {
      expect(fs.existsSync(path.join(modulePath, entry))).toBe(true);
    });
  });

  test('module index files expose router and public port', () => {
    moduleNames.forEach((moduleName) => {
      const moduleApi = require(path.join(modulesRoot, moduleName));

      expect(moduleApi).toHaveProperty('router');
      expect(moduleApi).toHaveProperty('publicPort');
    });
  });

  test('modules do not import another module internal layer', () => {
    const files = moduleNames.flatMap((moduleName) => collectJavaScriptFiles(path.join(modulesRoot, moduleName)));
    const forbiddenImportPattern = /require\(['"](?:\.\.\/)+([^'"]+)['"]\)/g;

    files.forEach((filePath) => {
      const currentModule = path.relative(modulesRoot, filePath).split(path.sep)[0];
      const source = fs.readFileSync(filePath, 'utf8');
      const matches = [...source.matchAll(forbiddenImportPattern)];

      matches.forEach((match) => {
        const normalizedTarget = match[1].replaceAll('\\', '/');
        const targetModule = normalizedTarget.split('/')[0];

        if (!moduleNames.includes(targetModule) || targetModule === currentModule) {
          return;
        }

        expect(normalizedTarget).toBe(`${targetModule}/public`);
      });
    });
  });
});
