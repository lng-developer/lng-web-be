jest.mock('../../../src/config/database', () => ({ connectDatabase: jest.fn(), disconnectDatabase: jest.fn() }));
jest.mock('../../../src/modules/listingLaunch/workers/listingContent.worker', () => ({ startListingContentWorker: jest.fn(), stopListingContentWorker: jest.fn() }));
const database = require('../../../src/config/database');
const worker = require('../../../src/modules/listingLaunch/workers/listingContent.worker');
test('entrypoint import is inert and shutdown closes resources once even if worker close fails', async () => {
  const runner = require('../../../src/modules/listingLaunch/workers/run');
  expect(database.connectDatabase).not.toHaveBeenCalled();
  expect(worker.startListingContentWorker).not.toHaveBeenCalled();
  await runner.start();
  expect(worker.startListingContentWorker).toHaveBeenCalledTimes(1);
  worker.stopListingContentWorker.mockRejectedValueOnce(new Error('close failed'));
  await expect(runner.shutdown()).rejects.toThrow('close failed');
  await expect(runner.shutdown()).rejects.toThrow('close failed');
  expect(worker.stopListingContentWorker).toHaveBeenCalledTimes(1);
  expect(database.disconnectDatabase).toHaveBeenCalledTimes(1);
});
