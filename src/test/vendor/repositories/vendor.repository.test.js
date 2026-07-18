const repository = require('../../../modules/vendor/repositories/vendor.repository');

describe('vendor.repository', () => {
  test('buildFilter supports operator-facing vendor id', () => {
    const filter = repository.buildFilter({
      id: '660000000000000000000501',
      code: 'print',
    });

    expect(String(filter._id)).toBe('660000000000000000000501');
    expect(filter.code).toEqual(/^print/i);
  });
});
