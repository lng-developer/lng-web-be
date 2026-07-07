const fs = require('fs');
const path = require('path');

const modulesRoot = path.resolve(__dirname, '..', 'modules');
const moduleNames = [
  'integration',
  'catalog',
  'order',
  'customization',
  'production',
  'finance',
  'design',
  'media',
  'mapping',
  'shipment',
  'vendor',
  'auth',
  'shop',
  'organization',
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

  test('auth module does not keep legacy department role permission persistence', () => {
    const authModulePath = path.join(modulesRoot, 'auth');

    expect(fs.existsSync(path.join(authModulePath, 'models', 'departmentRolePermission.model.js'))).toBe(false);
    expect(fs.existsSync(path.join(authModulePath, 'repositories', 'departmentRolePermission.repository.js'))).toBe(false);
  });

  test('protected module routes declare authentication and permission middleware', () => {
    const publicRouteAllowlist = [
      /^\/health$/,
      /^\/register$/,
      /^\/login$/,
      /^\/refresh$/,
      /^\/logout$/,
    ];
    const routeDeclarationPattern = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;

    moduleNames.forEach((moduleName) => {
      const routesPath = path.join(modulesRoot, moduleName, 'routes');
      const routeFiles = collectJavaScriptFiles(routesPath);

      routeFiles.forEach((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        const routePaths = [...source.matchAll(routeDeclarationPattern)].map((match) => match[2]);
        const hasProtectedRoute = routePaths.some((routePath) => (
          !publicRouteAllowlist.some((allowed) => allowed.test(routePath))
        ));

        if (!hasProtectedRoute) return;

        expect(source).toContain('authenticate');
        expect(source).toMatch(/authorize(?:Any|Scoped)?Permissions?/);
      });
    });
  });
});
