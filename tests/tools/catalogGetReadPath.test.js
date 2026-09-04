const { percentile, summarize } = require('../../tools/scripts/benchmarks/catalogGetReadPath');

describe('catalog GET read-path benchmark helpers', () => {
  test('calculates latency percentiles and an empty summary deterministically', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
    expect(summarize([])).toEqual({ count: 0, p50: null, p95: null, p99: null });
  });
});
