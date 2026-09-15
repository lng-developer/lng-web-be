const fs = require('fs');
const path = require('path');

const modulesRoot = path.resolve(__dirname, '../../..', 'src/modules');
const launchRoot = path.join(modulesRoot, 'listingLaunch');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(target) : entry.name.endsWith('.js') ? [target] : [];
  });
}

function crossModuleViolations(filename, source) {
  return [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].flatMap(([, specifier]) => {
    if (!specifier.startsWith('.')) return [];
    const resolved = path.resolve(path.dirname(filename), specifier);
    const relative = path.relative(modulesRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return [];
    const [owner, ...rest] = relative.split(path.sep);
    if (owner === 'listingLaunch') return [];
    return rest.length === 1 && ['public', 'public.js'].includes(rest[0]) ? [] : [specifier];
  });
}

test('guard rejects real relative internal imports and allows public ports', () => {
  const filename = path.join(launchRoot, 'services/listingLaunch.service.js');
  expect(crossModuleViolations(filename, "require('../../catalog/models/listing.model')"))
    .toEqual(['../../catalog/models/listing.model']);
  expect(crossModuleViolations(filename, "require('../../catalog/public')")).toEqual([]);
});

test('launch module calls only public ports across module boundaries', () => {
  expect(fs.existsSync(launchRoot)).toBe(true);
  for (const filename of filesUnder(launchRoot)) {
    expect({ filename, violations: crossModuleViolations(filename, fs.readFileSync(filename, 'utf8')) })
      .toEqual({ filename, violations: [] });
  }
});

test('application mounts launch endpoints with declared authentication and permissions', () => {
  const { buildRouteInventory } = require('../../../tools/api-contract/routeInventory');
  const routes = buildRouteInventory().filter((route) => route.module === 'listingLaunch');
  expect(routes.map(({ method, path: routePath }) => `${method} ${routePath}`).sort()).toEqual([
    'GET /api/listing-launches',
    'GET /api/listing-launches/:id',
    'GET /api/listing-launches/:id/content-generations/:runId',
    'GET /api/listing-launches/:id/content-versions',
    'PATCH /api/listing-launches/:id',
    'POST /api/listing-launches',
    'POST /api/listing-launches/:id/content-generations',
    'POST /api/listing-launches/:id/content-versions/:versionId/revisions',
    'POST /api/listing-launches/:id/content-versions/:versionId/approve',
    'POST /api/listing-launches/:id/select-product',
    'PUT /api/listing-launches/:id/content-inputs',
  ].sort());
  for (const route of routes) {
    expect(route.authenticated).toBe(true);
    expect(route.permissions).toEqual(route.method === 'GET'
      ? ['CATALOG:READ', 'CATALOG:WRITE'] : ['CATALOG:WRITE']);
  }
});
