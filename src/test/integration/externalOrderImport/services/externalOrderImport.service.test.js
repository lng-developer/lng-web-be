jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository', () => ({
  list: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({
  listByJob: jest.fn(),
}));

jest.mock('../../../../modules/integration/externalOrderImport/sources/manualExcel/manualExcelImport.service', () => ({
  importManualExcelOrderReport: jest.fn(),
  importEtsySoldOrderItems: jest.fn(),
}));

const issueRepository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository');
const service = require('../../../../modules/integration/externalOrderImport/services/externalOrderImport.service');

describe('externalOrderImport.service issue workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    issueRepository.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
  });

  test('lists issues with external order filters', async () => {
    await service.listIssues({
      externalOrderId: '114-1',
      externalItemId: 'ITEM-1',
      issueType: 'CUSTOMIZATION_MISMATCH',
      status: 'OPEN',
    });

    expect(issueRepository.list).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: '114-1',
      externalItemId: 'ITEM-1',
      issueType: 'CUSTOMIZATION_MISMATCH',
      status: 'OPEN',
    }));
  });

  test('does not expose manual resolve or ignore actions', () => {
    expect(service.resolveIssue).toBeUndefined();
    expect(service.ignoreIssue).toBeUndefined();
  });
});
