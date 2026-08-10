jest.mock('../../../src/modules/auth/public', () => ({
  authenticate: function authenticate(req, res, next) { next(); },
  authorizeAnyPermission: () => function authorize(req, res, next) { next(); },
}));

jest.mock('../../../src/modules/workScore/controllers/workScore.controller', () => ({
  getScore: jest.fn(),
  listScores: jest.fn(),
  overrideScore: jest.fn(),
  summarizeScores: jest.fn(),
  voidScore: jest.fn(),
}));

const router = require('../../../src/modules/workScore/routes');
const {
  listQuerySchema,
  overrideSchema,
  voidSchema,
} = require('../../../src/modules/workScore/validators/workScore.validator');

describe('workScore routes', () => {
  test('exposes reads and controlled mutations without manual create', () => {
    const routes = router.stack.filter((layer) => layer.route).map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
    }));
    expect(routes).toEqual(expect.arrayContaining([
      { path: '/', methods: ['get'] },
      { path: '/summary', methods: ['get'] },
      { path: '/:scoreId', methods: ['get'] },
      { path: '/:scoreId/override', methods: ['patch'] },
      { path: '/:scoreId/void', methods: ['patch'] },
    ]));
    expect(routes.some((route) => route.methods.includes('post'))).toBe(false);
  });

  test('normalizes filters and validates versioned adjustments', () => {
    expect(listQuerySchema.validate({ sourceType: 'production_scale', page: '2' }).value)
      .toMatchObject({ sourceType: 'PRODUCTION_SCALE', page: 2 });
    expect(overrideSchema.validate({ points: -1, reason: 'x', expectedVersion: 0 }).error).toBeTruthy();
    expect(voidSchema.validate({ reason: 'Duplicate', expectedVersion: 2 }).error).toBeFalsy();
  });
});
