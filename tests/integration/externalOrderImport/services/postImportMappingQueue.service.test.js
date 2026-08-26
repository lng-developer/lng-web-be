const mockQueue = {
  add: jest.fn(),
};

jest.mock('../../../../src/config/queue', () => ({
  createQueue: jest.fn(() => mockQueue),
}));

jest.mock('../../../../src/config', () => ({
  redis: { enabled: true },
}));

jest.mock('../../../../src/shared/utils/logger', () => ({
  warn: jest.fn(),
}));

jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({
  updatePostImportResult: jest.fn(),
}));

const rawRecordRepository = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository');
const service = require('../../../../src/modules/integration/externalOrderImport/services/postImportMappingQueue.service');

describe('postImportMappingQueue.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueue.add.mockResolvedValue({});
    rawRecordRepository.updatePostImportResult.mockResolvedValue({});
    service.resetPostImportQueueForTest();
  });

  test.each([
    ['orderItemId', { importJobId: 'job-1', rawRecordId: 'raw-1' }],
    ['rawRecordId', { importJobId: 'job-1', orderItemId: 'item-1' }],
  ])('rejects an incomplete payload before mutation when %s is missing', async (missingField, payload) => {
    const result = await service.enqueuePostImportMappingJob(payload);

    expect(result).toMatchObject({
      queued: false,
      errorCode: 'POST_IMPORT_QUEUE_UNAVAILABLE',
    });
    expect(rawRecordRepository.updatePostImportResult).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  test('uses a BullMQ-compatible unique job id for a forced retry', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1766500000000);

    await service.enqueuePostImportMappingJob({
      importJobId: 'job-1',
      rawRecordId: 'raw-1',
      orderItemId: 'item-1',
    }, { force: true });

    expect(mockQueue.add).toHaveBeenCalledWith('mapping-recheck', expect.any(Object), expect.objectContaining({
      jobId: 'post-import:job-1:item-1-1766500000000',
    }));
  });
});
