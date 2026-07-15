jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({
  updatePostImportResult: jest.fn(),
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
    rawRecordRepository.updatePostImportResult.mockResolvedValue({});
    issueRepository.create.mockResolvedValue({});
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({ status: 'BLOCKED' });
  });

  test('runs mapping recheck and marks all raw records completed', async () => {
    await processPostImportMappingJob({ data: payload });

    expect(rawRecordRepository.updatePostImportResult).toHaveBeenCalledWith(
      '660000000000000000000501',
      expect.objectContaining({ postImportStatus: 'PROCESSING' }),
      { incrementAttempts: true },
    );
    expect(rawRecordRepository.updatePostImportResult).toHaveBeenCalledWith(
      '660000000000000000000502',
      expect.objectContaining({ postImportStatus: 'PROCESSING' }),
      { incrementAttempts: true },
    );
    expect(mappingPublic.recheckFulfillmentPlan).toHaveBeenCalledWith(payload.orderItemId, {}, {
      system: true,
      source: 'EXTERNAL_ORDER_IMPORT',
    });
    expect(rawRecordRepository.updatePostImportResult).toHaveBeenCalledWith(
      '660000000000000000000501',
      expect.objectContaining({ postImportStatus: 'COMPLETED', postImportErrorCode: null }),
    );
    expect(issueRepository.create).not.toHaveBeenCalled();
  });

  test('marks failed and creates import issue when mapping throws', async () => {
    mappingPublic.recheckFulfillmentPlan.mockRejectedValue(new Error('mapping down'));

    await expect(processPostImportMappingJob({ data: payload })).rejects.toThrow('mapping down');

    expect(rawRecordRepository.updatePostImportResult).toHaveBeenCalledWith(
      '660000000000000000000501',
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
});
