test('background execution defaults to combined with new flows disabled', () => {
  const config = require('../../src/config');
  expect(config.runtime.role).toBe('combined');
  expect(config.shipment.trackingQueueEnabled).toBe(false);
  expect(config.finance.durableRecalculationEnabled).toBe(false);
  expect(config.mapping.durableSideEffectsEnabled).toBe(false);
});
