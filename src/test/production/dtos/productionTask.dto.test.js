const {
  toFileCheckDto,
  toProductionTaskSummaryDto,
} = require('../../../modules/production/dtos/productionTask.dto');

describe('productionTask.dto', () => {
  test('adds media download URLs for file check assets', () => {
    const dto = toFileCheckDto({
      _id: '660000000000000000100003',
      slotKey: 'PSD_TEMPLATE',
      sourceType: 'PSD_TEMPLATE',
      inputAssetId: '660000000000000000000901',
      outputAssetId: '660000000000000000000902',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
    });

    expect(dto).toMatchObject({
      inputAssetId: '660000000000000000000901',
      inputAssetDownloadUrl: '/api/media/assets/660000000000000000000901/download',
      outputAssetId: '660000000000000000000902',
      outputAssetDownloadUrl: '/api/media/assets/660000000000000000000902/download',
    });
  });

  test('summary task exposes PSD_TEMPLATE download URL through fileChecks', () => {
    const dto = toProductionTaskSummaryDto({
      _id: '660000000000000000100001',
      orderItemId: '660000000000000000000401',
      fileChecks: [{
        slotKey: 'PSD_TEMPLATE',
        sourceType: 'PSD_TEMPLATE',
        inputAssetId: '660000000000000000000901',
      }],
    });

    expect(dto.fileChecks[0]).toMatchObject({
      slotKey: 'PSD_TEMPLATE',
      inputAssetDownloadUrl: '/api/media/assets/660000000000000000000901/download',
    });
  });
});
