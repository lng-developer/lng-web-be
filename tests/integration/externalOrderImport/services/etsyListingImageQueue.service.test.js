jest.mock('../../../../src/config/queue', () => ({ createQueue: jest.fn() }));
jest.mock('../../../../src/config', () => ({ redis: { enabled: true } }));
jest.mock('../../../../src/shared/utils/logger', () => ({ warn: jest.fn() }));
const { createQueue } = require('../../../../src/config/queue');
const add = jest.fn();
const getJob = jest.fn();
createQueue.mockReturnValue({ add, getJob, on: jest.fn() });
const { enqueueListingImages } = require('../../../../src/modules/integration/externalOrderImport/services/etsyListingImageQueue.service');
const dto = { salesChannelCode: 'ETSY', shopId: 'shop', items: [{ externalItemId: 'tx', externalData: { etsy: { listingImageUrl: 'https://i.etsystatic.com/a.jpg' } } }] };
const result = { itemResults: [{ externalItemId: 'tx', orderItemId: 'item' }] };
beforeEach(() => { add.mockReset(); getJob.mockReset(); });
test('queues image separately with bounded retries and stable identity', async () => {
  await enqueueListingImages(dto, result);
  expect(add).toHaveBeenCalledWith('save-image', { orderItemId: 'item', shopId: 'shop', sourceUrl: 'https://i.etsystatic.com/a.jpg' }, expect.objectContaining({ attempts: 3, jobId: expect.not.stringContaining(':') }));
});
test('queue outage does not reject imported order', async () => {
  getJob.mockRejectedValue(new Error('offline'));
  await expect(enqueueListingImages(dto, result)).resolves.toBeUndefined();
});
test('reimport can retry exhausted failed image job', async () => {
  const retry = jest.fn();
  getJob.mockResolvedValue({ getState: async () => 'failed', retry });
  await enqueueListingImages(dto, result);
  expect(retry).toHaveBeenCalled();
  expect(add).not.toHaveBeenCalled();
});
test('Amazon and missing image never queue', async () => {
  await enqueueListingImages({ ...dto, salesChannelCode: 'AMAZON' }, result);
  await enqueueListingImages({ ...dto, items: [] }, result);
  expect(add).not.toHaveBeenCalled();
});
