const mockQueue = {
  add: jest.fn(),
};

jest.mock('../../../../config/queue', () => ({
  createQueue: jest.fn(() => mockQueue),
}));

jest.mock('../../../../config', () => ({
  redis: { enabled: true },
}));

jest.mock('../../../../shared/utils/logger', () => ({
  warn: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({
  updatePostImportResult: jest.fn(),
}));

const rawRecordRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository');
const service = require('../../../../modules/integration/externalOrderImport/services/postImportMappingQueue.service');

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
});
