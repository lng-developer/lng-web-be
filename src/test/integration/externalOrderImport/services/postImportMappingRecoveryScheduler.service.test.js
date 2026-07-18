jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({
  listStalePostImportRecords: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/services/postImportMappingProcessor.service', () => ({
  processPostImportMapping: jest.fn(),
}));

const rawRecordRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository');
const processor = require('../../../../modules/integration/externalOrderImport/services/postImportMappingProcessor.service');
const scheduler = require('../../../../modules/integration/externalOrderImport/services/postImportMappingRecoveryScheduler.service');

describe('postImportMappingRecoveryScheduler.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reprocesses stale queued records through the shared processor', async () => {
    rawRecordRepository.listStalePostImportRecords.mockResolvedValue([{
      _id: '660000000000000000000501',
      importJobId: '660000000000000000000601',
      orderId: '660000000000000000000301',
      orderItemId: '660000000000000000000401',
      externalOrderId: '113-1',
      externalItemId: 'ITEM-1',
    }]);
    processor.processPostImportMapping.mockResolvedValue({ skipped: false });

    const result = await scheduler.runOnce({ staleAfterMs: 0 });

    expect(rawRecordRepository.listStalePostImportRecords).toHaveBeenCalledWith(expect.objectContaining({
      limit: 50,
      cutoff: expect.any(Date),
    }));
    expect(processor.processPostImportMapping).toHaveBeenCalledWith(expect.objectContaining({
      rawRecordId: '660000000000000000000501',
      orderItemId: '660000000000000000000401',
    }), { isFinalAttempt: true });
    expect(result).toEqual({ checked: 1, processed: 1, skipped: 0, failed: 0 });
  });
});
