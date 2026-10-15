jest.mock('../../../../src/modules/integration/externalOrderImport/services/externalOrderImport.service', () => ({ loadAuthorizedImportJob: jest.fn() }));
jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({ findImportedItem: jest.fn() }));
jest.mock('../../../../src/modules/media/public', () => ({ getAsset: jest.fn(), storeImportAsset: jest.fn() }));
jest.mock('../../../../src/modules/customization/public', () => ({ attachEtsyImportAssets: jest.fn() }));
jest.mock('../../../../src/modules/integration/externalOrderImport/services/postImportMappingQueue.service', () => ({ enqueuePostImportMappingJob: jest.fn() }));
const jobs = require('../../../../src/modules/integration/externalOrderImport/services/externalOrderImport.service');
const raw = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository');
const media = require('../../../../src/modules/media/public');
const customization = require('../../../../src/modules/customization/public');
const service = require('../../../../src/modules/integration/externalOrderImport/services/etsyCustomizationManifest.service');
const queue = require('../../../../src/modules/integration/externalOrderImport/services/postImportMappingQueue.service');
beforeEach(() => {
  jest.resetAllMocks();
  jobs.loadAuthorizedImportJob.mockResolvedValue({ _id: 'job', shopId: 'shop', salesChannelCode: 'ETSY' });
  raw.findImportedItem.mockResolvedValue({ _id: 'raw', orderId: 'order', orderItemId: 'item' });
});
test('denied job access prevents any media upload', async () => {
  jobs.loadAuthorizedImportJob.mockRejectedValue(new Error('Forbidden'));
  await expect(service.uploadAsset('job', {}, 'hash', {})).rejects.toThrow('Forbidden');
  expect(media.storeImportAsset).not.toHaveBeenCalled();
});
test('foreign job asset cannot attach to an imported transaction', async () => {
  media.getAsset.mockResolvedValue({ _id: 'asset', shopId: 'shop', ownerId: 'other', ownerType: 'ETSY_IMPORT', uploadStatus: 'READY' });
  const result = await service.attachManifest('job', [{ externalOrderId: '1', externalItemId: '2', assets: [{ mediaAssetId: 'asset' }] }], {});
  expect(result.entries[0].status).toBe('failed');
  expect(customization.attachEtsyImportAssets).not.toHaveBeenCalled();
});
test('unmatched transaction is a failure, never a guessed order item', async () => {
  raw.findImportedItem.mockResolvedValue(null);
  const result = await service.attachManifest('job', [{ externalOrderId: '1', externalItemId: '2', assets: [] }], {});
  expect(result.entries[0].status).toBe('failed');
});

test('queue rejection leaves attachment resumable instead of accepted', async () => {
  customization.attachEtsyImportAssets.mockResolvedValue({ status: 'PARSED' });
  queue.enqueuePostImportMappingJob.mockResolvedValue({ queued: false });
  const result = await service.attachManifest('job', [{ externalOrderId: '1', externalItemId: '2', assets: [] }], {});
  expect(result.entries[0].status).toBe('retry');
});
