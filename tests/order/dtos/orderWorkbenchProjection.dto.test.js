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
      items: [{
        item: { sku: 'J2501-TS2S' },
        production: { qcStatus: 'APPROVED', scaledOutputs: [] },
        psd: { listingPsd: null, listingVariant: null },
      }],
    });
  });

  test('extracts scaledOutputs from production file checks or scale slots', () => {
    const row = toOrderWorkbenchRow({
      order: { externalOrderId: '114-2' },
      items: [{
        orderItemId: 'item-1',
        item: { sku: 'J2501-TS2S' },
        production: {
          qcStatus: 'NOT_READY',
          qcPreviewFileChecks: [
            {
              id: 'check-1',
              slotKey: 'FRONT',
              slotLabel: 'Front',
              outputAssetId: 'asset-1',
              scaleStatus: 'SCALED',
              qcStatus: 'NOT_READY',
            },
            {
              id: 'check-2',
              slotKey: 'PSD_TEMPLATE',
              outputAssetId: null,
            },
          ],
        },
      }],
    });

    expect(row.items[0].production.scaledOutputs).toEqual([
      {
        id: 'check-1',
        slotKey: 'FRONT',
        slotLabel: 'Front',
        outputAssetId: 'asset-1',
        outputAssetDownloadUrl: '/api/media/assets/asset-1/download',
        scaleStatus: 'SCALED',
        qcStatus: 'NOT_READY',
      },
    ]);
  });
});
