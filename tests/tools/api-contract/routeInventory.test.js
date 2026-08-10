const { buildRouteInventory } = require('../../../tools/api-contract/routeInventory');

describe('API contract route inventory', () => {
  test('discovers mounted routes with authentication and permission metadata', () => {
    const inventory = buildRouteInventory();

    expect(inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        module: 'catalog',
        method: 'POST',
        path: '/api/catalog/listings/:id/variants/:variantId/request-psd',
        authenticated: true,
        permissions: ['CATALOG:WRITE'],
      }),
      expect.objectContaining({
        module: 'production',
        method: 'PATCH',
        path: '/api/production/tasks/:taskId/qc',
        authenticated: true,
        permissions: ['PRODUCTION:WRITE', 'DESIGN:REVIEW'],
      }),
      expect.objectContaining({
        module: 'catalog',
        method: 'GET',
        path: '/api/catalog/health',
        authenticated: false,
        permissions: [],
      }),
      expect.objectContaining({
        module: 'integration',
        method: 'POST',
        path: '/api/integration/external-order-imports/manual-excel',
        authenticated: true,
        permissions: ['ORDERS:WRITE'],
      }),
      expect.objectContaining({
        module: 'integration',
        method: 'POST',
        path: '/api/hr/integrations/sql-attendance/sync',
        authenticated: true,
        permissions: ['HR_INTEGRATIONS:MANAGE'],
      }),
    ]));
  });

  test('returns unique method and path pairs in deterministic order', () => {
    const inventory = buildRouteInventory();
    const keys = inventory.map(({ method, path }) => `${method} ${path}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(inventory).toEqual([...inventory].sort((a, b) => (
      a.module.localeCompare(b.module)
      || a.path.localeCompare(b.path)
      || a.method.localeCompare(b.method)
    )));
  });
});
