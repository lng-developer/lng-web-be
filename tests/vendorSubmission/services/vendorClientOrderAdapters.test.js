describe.each(['mangotee', 'printway'])('%s persisted client order IDs', (name) => {
  const adapter = require(`../../../src/modules/vendorSubmission/services/submitAdapters/${name}.adapter`);
  test('uses the reserved ID instead of the marketplace ID or internal operation key', () => {
    const row = { payloadSnapshot: { vendorClientOrderId: '113-ORDER-R3', orderItem: { externalOrderId: '113-ORDER' } } };
    expect(adapter.buildPayload(row, { idempotencyKey: 'submission:internal' }).order_id).toBe('113-ORDER-R3');
    expect(row.payloadSnapshot.orderItem.externalOrderId).toBe('113-ORDER');
  });
});
