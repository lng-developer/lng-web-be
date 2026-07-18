jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({
  claimPostImportRecords: jest.fn(),
  updatePostImportResultForLease: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository', () => ({
  create: jest.fn(),
}));

jest.mock('../../../../modules/mapping/public', () => ({
  recheckFulfillmentPlan: jest.fn(),
}));

const rawRecordRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository');
const issueRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository');
const mappingPublic = require('../../../../modules/mapping/public');
const {
  processPostImportMappingJob,
} = require('../../../../modules/integration/externalOrderImport/workers/postImportMapping.worker');

describe('postImportMapping.worker', () => {
  const payload = {
    importJobId: '660000000000000000000601',
    rawRecordId: '660000000000000000000501',
    rawRecordIds: ['660000000000000000000501', '660000000000000000000502'],
    orderId: '660000000000000000000301',
    orderItemId: '660000000000000000000401',
    externalOrderId: '113-1',
    externalItemId: 'ITEM-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    rawRecordRepository.claimPostImportRecords.mockResolvedValue(true);
    rawRecordRepository.updatePostImportResultForLease.mockResolvedValue({});
    issueRepository.create.mockResolvedValue({});
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({ status: 'BLOCKED' });
  });

  test('runs mapping recheck and marks all raw records completed', async () => {
    await processPostImportMappingJob({ data: payload });

    expect(rawRecordRepository.claimPostImportRecords).toHaveBeenCalledWith(
      payload.rawRecordIds,
      expect.any(String),
      expect.objectContaining({ leaseMs: expect.any(Number) }),
    );
    expect(mappingPublic.recheckFulfillmentPlan).toHaveBeenCalledWith(payload.orderItemId, {}, {
      system: true,
      source: 'EXTERNAL_ORDER_IMPORT',
    });
    expect(rawRecordRepository.updatePostImportResultForLease).toHaveBeenCalledWith(
      '660000000000000000000501',
      expect.any(String),
      expect.objectContaining({ postImportStatus: 'COMPLETED', postImportErrorCode: null }),
    );
    expect(issueRepository.create).not.toHaveBeenCalled();
  });

  test('marks failed and creates import issue when mapping throws', async () => {
    mappingPublic.recheckFulfillmentPlan.mockRejectedValue(new Error('mapping down'));

    await expect(processPostImportMappingJob({ data: payload })).rejects.toThrow('mapping down');

    expect(rawRecordRepository.updatePostImportResultForLease).toHaveBeenCalledWith(
      '660000000000000000000501',
      expect.any(String),
      expect.objectContaining({
        postImportStatus: 'FAILED',
        postImportErrorCode: 'MAPPING_RECHECK_FAILED',
        postImportErrorMessage: 'mapping down',
      }),
    );
    expect(issueRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      importJobId: payload.importJobId,
      rawRecordId: payload.rawRecordId,
      externalOrderId: payload.externalOrderId,
      externalItemId: payload.externalItemId,
      issueType: 'MAPPING_RECHECK_FAILED',
      errorMessage: 'mapping down',
    }));
  });

  test('skips mapping when another worker already owns the lease', async () => {
    rawRecordRepository.claimPostImportRecords.mockResolvedValue(false);

    await processPostImportMappingJob({ data: payload });

    expect(mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
    expect(rawRecordRepository.updatePostImportResultForLease).not.toHaveBeenCalled();
  });
});
