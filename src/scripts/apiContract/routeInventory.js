const fs = require('fs');
const path = require('path');
const { modules } = require('../../modules');

const modulesIndexPath = path.resolve(__dirname, '../../modules/index.js');

function mountedRouters() {
  const source = fs.readFileSync(modulesIndexPath, 'utf8');
  const mounts = [];
  const pattern = /router\.use\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const [, mountPath, moduleName, routerProperty] = match;
    const router = modules[moduleName]?.[routerProperty];
    if (router) mounts.push({ mountPath, module: moduleName, router });
  }
  return mounts;
}

function normalizePath(...parts) {
  return `/${parts.join('/').split('/').filter(Boolean).join('/')}`;
}

function routeMetadata(moduleName, mountPath, layer) {
  if (!layer.route) return [];
  const middleware = layer.route.stack.map((item) => item.handle || item);
  const authorization = middleware.find((handle) => handle?.authorization)?.authorization || null;
  const authenticated = middleware.some((handle) => handle?.name === 'authenticate');
  return Object.keys(layer.route.methods)
    .filter((method) => layer.route.methods[method])
    .map((method) => ({
      module: moduleName,
      method: method.toUpperCase(),
      path: normalizePath('api', mountPath, layer.route.path),
      authenticated,
      authorizationMode: authorization?.mode || null,
      permissions: authorization?.permissions || [],
      roles: authorization?.roles || [],
    }));
}

function routerMetadata(moduleName, mountPath, router) {
  return router.stack.flatMap((layer) => {
    if (layer.route) return routeMetadata(moduleName, mountPath, layer);
    const nestedPath = layer.handle?.apiContractMountPath;
    return nestedPath && layer.handle?.stack
      ? routerMetadata(moduleName, normalizePath(mountPath, nestedPath), layer.handle)
      : [];
  });
}

function buildRouteInventory() {
  const inventory = mountedRouters().flatMap(({ module, mountPath, router }) => (
    routerMetadata(module, mountPath, router)
  ));
  return inventory.sort((left, right) => (
    left.module.localeCompare(right.module)
    || left.path.localeCompare(right.path)
    || left.method.localeCompare(right.method)
  ));
}

function main() {
  process.stdout.write(`${JSON.stringify(buildRouteInventory(), null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { buildRouteInventory };
