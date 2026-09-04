const { toOrderWorkbenchRow } = require('../../../src/modules/order/dtos/orderWorkbenchProjection.dto');

describe('orderWorkbenchProjection dto', () => {
  test('adapts the compact persisted row to the existing workbench row', () => {
    expect(toOrderWorkbenchRow({
      order: { externalOrderId: '114-1' },
      shop: { name: 'US Store' },
      case: { title: 'Address issue' },
      items: [{
        orderItemId: 'item-1', item: { sku: 'J2501-TS2S' }, production: { qcStatus: 'APPROVED' },
      }],
    })).toEqual({
      order: { externalOrderId: '114-1' },
      shop: { name: 'US Store' },
      case: { title: 'Address issue' },
      items: [{ item: { sku: 'J2501-TS2S' }, production: { qcStatus: 'APPROVED' } }],
    });
  });
});
