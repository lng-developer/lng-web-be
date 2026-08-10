const {
  parseJsonFile,
  validateApiContracts,
} = require('../../../tools/api-contract/validateApiContracts');

function collection(items, variables = []) {
  return {
    info: { name: 'Test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: variables.map((key) => ({ key, value: '' })),
    item: items,
  };
}

function request(name, method, url, body = null) {
  return { name, request: { method, url: { raw: url }, ...(body ? { body } : {}) } };
}

describe('API contract validation', () => {
  const inventory = [
    { module: 'catalog', method: 'GET', path: '/api/catalog/listings/:id' },
    { module: 'catalog', method: 'POST', path: '/api/catalog/listings' },
  ];

  test('reports missing, unknown, duplicate, and unresolved-variable findings', () => {
    const result = validateApiContracts({
      inventory,
      collections: [collection([
        request('Get listing', 'GET', '{{baseUrl}}/api/catalog/listings/{{listingId}}'),
        request('Duplicate listing', 'GET', '{{baseUrl}}/api/catalog/listings/{{listingId}}'),
        request('Unknown route', 'DELETE', '{{baseUrl}}/api/catalog/unknown/{{unknownId}}'),
      ], ['baseUrl', 'listingId'])],
      environmentVariables: ['baseUrl'],
      exclusions: { modulesPending: [] },
    });

    expect(result.missing).toEqual(['POST /api/catalog/listings']);
    expect(result.unknown).toEqual(['DELETE /api/catalog/unknown/:param']);
    expect(result.duplicates).toEqual(['GET /api/catalog/listings/:param']);
    expect(result.missingVariables).toEqual(['unknownId']);
  });

  test('allows only explicitly pending modules to remain undocumented', () => {
    const result = validateApiContracts({
      inventory,
      collections: [],
      exclusions: { modulesPending: ['catalog'] },
    });

    expect(result.missing).toEqual([]);
    expect(result.excluded).toHaveLength(2);
  });

  test('rejects exclusions for modules absent from the route inventory', () => {
    const result = validateApiContracts({
      inventory,
      collections: [],
      exclusions: { modulesPending: ['invented-module'] },
    });

    expect(result.invalidExclusions).toEqual(['invented-module']);
  });

  test('parseJsonFile reports invalid Postman JSON with its path', () => {
    expect(() => parseJsonFile('broken.postman_collection.json', '{nope'))
      .toThrow('Invalid JSON in broken.postman_collection.json');
  });
});
