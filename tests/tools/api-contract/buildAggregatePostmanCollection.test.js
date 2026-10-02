const { buildAggregate, buildIndex } = require('../../../tools/api-contract/buildAggregatePostmanCollection');

function requestCount(items = []) {
  return items.reduce((total, item) => total + (item.request ? 1 : requestCount(item.item)), 0);
}

describe('aggregate Postman handoff', () => {
  test('contains every module request exactly once', () => {
    const collection = buildAggregate();
    expect(collection.item).toHaveLength(20);
    expect(requestCount(collection.item)).toBe(442);
  });

  test('publishes the current totals in the endpoint index', () => {
    expect(buildIndex()).toContain('**491 endpoints** across **23 modules**');
  });
});
