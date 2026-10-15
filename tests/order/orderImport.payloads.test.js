const { buildOrderCreatePayload, buildOrderUpdatePayload } = require('../../src/modules/order/services/orderImport.payloads');

test('persists explicit imported payment state without changing internal order lifecycle', () => {
  const dto = { source: 'MANUAL_EXCEL', paymentStatus: 'PAID', externalStatus: 'Completed' };
  expect(buildOrderCreatePayload(dto, {}, new Date())).toMatchObject({ paymentStatus: 'PAID', externalStatus: 'Completed', status: 'IMPORTED' });
  expect(buildOrderUpdatePayload(dto, new Date()).set).toMatchObject({ paymentStatus: 'PAID' });
  expect(buildOrderUpdatePayload({ source: 'MANUAL_EXCEL' }, new Date()).set).not.toHaveProperty('paymentStatus');
});
