const {
  getPaginationOffset,
  normalizePagination,
  toPaginatedResult,
  toPaginatedResponse,
} = require('./pagination');

describe('pagination utils', () => {
  test('normalizePagination applies defaults and caps limit', () => {
    expect(normalizePagination({ page: '0', limit: '999' })).toEqual({
      page: 1,
      limit: 100,
    });
  });

  test('normalizePagination supports custom defaults', () => {
    expect(normalizePagination({}, { defaultLimit: 50, maxLimit: 200 })).toEqual({
      page: 1,
      limit: 50,
    });
  });

  test('toPaginatedResponse maps items without changing metadata', () => {
    const result = toPaginatedResponse(
      { items: [{ value: 1 }], total: 1, page: 2, limit: 10 },
      (item) => ({ doubled: item.value * 2 }),
    );

    expect(result).toEqual({
      items: [{ doubled: 2 }],
      total: 1,
      page: 2,
      limit: 10,
    });
  });

  test('getPaginationOffset calculates skip from normalized page and limit', () => {
    expect(getPaginationOffset({ page: 3, limit: 25 })).toBe(50);
  });

  test('toPaginatedResult returns the standard repository pagination shape', () => {
    expect(toPaginatedResult({
      items: [{ id: 1 }],
      total: 1,
      page: 1,
      limit: 20,
    })).toEqual({
      items: [{ id: 1 }],
      total: 1,
      page: 1,
      limit: 20,
    });
  });
});
