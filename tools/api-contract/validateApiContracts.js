const fs = require('fs');
const path = require('path');
const { buildRouteInventory } = require('./routeInventory');

const postmanDir = path.resolve(__dirname, '../../docs/api/postman');

function parseJsonFile(filePath, content) {
  try {
    return JSON.parse(content === undefined ? fs.readFileSync(filePath, 'utf8') : content);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function normalizedPath(value = '') {
  const withoutOrigin = value.replace(/^\{\{baseUrl\}\}/, '').replace(/^https?:\/\/[^/]+/, '');
  const pathOnly = withoutOrigin.split('?')[0] || '/';
  return `/${pathOnly.split('/').filter(Boolean).map((segment) => (
    /^:[^/]+$/.test(segment) || /^\{\{[^}]+\}\}$/.test(segment) ? ':param' : segment
  )).join('/')}`;
}

function flattenRequests(items = []) {
  return items.flatMap((item) => (item.request
    ? [item]
    : flattenRequests(item.item || [])));
}

function variablesIn(value) {
  return [...JSON.stringify(value).matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1]);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function validateApiContracts({
  inventory = [], collections = [], environmentVariables = [], exclusions = {},
}) {
  const pendingModules = new Set(exclusions.modulesPending || []);
  const inventoryModules = new Set(inventory.map((route) => route.module));
  const invalidExclusions = [...pendingModules].filter((moduleName) => !inventoryModules.has(moduleName)).sort();
  const excludedRoutes = inventory.filter((route) => pendingModules.has(route.module));
  const expectedKeys = new Set(inventory
    .filter((route) => !pendingModules.has(route.module))
    .map((route) => `${route.method} ${normalizedPath(route.path)}`));

  const requests = collections.flatMap((entry) => flattenRequests(entry.item || []));
  const requestKeys = requests.map((entry) => (
    `${String(entry.request.method || '').toUpperCase()} ${normalizedPath(entry.request.url?.raw || entry.request.url)}`
  ));
  const counts = requestKeys.reduce((result, key) => ({ ...result, [key]: (result[key] || 0) + 1 }), {});
  const declaredVariables = new Set([
    ...environmentVariables,
    ...collections.flatMap((entry) => (entry.variable || []).map((variable) => variable.key)),
  ]);

  return {
    missing: uniqueSorted([...expectedKeys].filter((key) => !requestKeys.includes(key))),
    unknown: uniqueSorted(requestKeys.filter((key) => !expectedKeys.has(key))),
    duplicates: uniqueSorted(Object.entries(counts).filter(([, count]) => count > 1).map(([key]) => key)),
    missingVariables: uniqueSorted(collections
      .flatMap(variablesIn)
      .filter((variable) => !declaredVariables.has(variable))),
    invalidExclusions,
    excluded: excludedRoutes,
  };
}

function readPostmanFiles() {
  if (!fs.existsSync(postmanDir)) return { collections: [], environmentVariables: [] };
  const files = fs.readdirSync(postmanDir);
  const collections = files
    .filter((name) => name.endsWith('.postman_collection.json'))
    .map((name) => parseJsonFile(path.join(postmanDir, name)));
  const environmentVariables = uniqueSorted(files
    .filter((name) => name.endsWith('.postman_environment.json'))
    .flatMap((name) => (parseJsonFile(path.join(postmanDir, name)).values || []).map((value) => value.key)));
  return { collections, environmentVariables };
}

function main() {
  const { collections, environmentVariables } = readPostmanFiles();
  const exclusionsPath = path.join(postmanDir, 'contract-exclusions.json');
  const exclusions = fs.existsSync(exclusionsPath) ? parseJsonFile(exclusionsPath) : {};
  const result = validateApiContracts({
    inventory: buildRouteInventory(), collections, environmentVariables, exclusions,
  });
  process.stdout.write(`${JSON.stringify({
    ...result,
    excluded: undefined,
    excludedCount: result.excluded.length,
  }, null, 2)}\n`);
  if (result.missing.length || result.unknown.length || result.duplicates.length
    || result.missingVariables.length || result.invalidExclusions.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { parseJsonFile, validateApiContracts };
