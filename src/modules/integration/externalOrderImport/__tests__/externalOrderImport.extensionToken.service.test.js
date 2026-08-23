jest.mock('../../../auth/public', () => ({ canAccessScope: jest.fn() }));
jest.mock('../sources/manualExcel/manualExcelImport.service', () => ({ prepareQueuedManualExcelOrderReport: jest.fn() }));
jest.mock('../services/externalOrderImportQueue.service', () => ({ enqueueImportJob: jest.fn() }));
jest.mock('../repositories/externalOrderImportJob.repository', () => ({}));
jest.mock('../repositories/externalOrderImportIssue.repository', () => ({}));
jest.mock('../repositories/externalOrderRawRecord.repository', () => ({}));
jest.mock('../services/postImportMappingQueue.service', () => ({}));
jest.mock('../../../order/public', () => ({}));
jest.mock('../../../mapping/public', () => ({}));
jest.mock('../../../production/public', () => ({}));

const manualExcelImportService = require('../sources/manualExcel/manualExcelImport.service');
const authPublic = require('../../../auth/public');
const service = require('../services/externalOrderImport.service');

test('uses the extension token shop instead of the client-provided shopId', async () => {
  authPublic.canAccessScope.mockReturnValue(true);
  manualExcelImportService.prepareQueuedManualExcelOrderReport.mockResolvedValue({ jobId: 'job-1', status: 'PENDING' });

  await service.importFromManualExcel(
    { shopId: 'client-shop', buffer: Buffer.from('x'), originalFilename: 'orders.csv', marketplaceCode: 'US' },
    { tokenType: 'EXTENSION', scopes: [{ scopeType: 'shop', scopeId: 'token-shop' }] },
  );

  expect(manualExcelImportService.prepareQueuedManualExcelOrderReport).toHaveBeenCalledWith(expect.objectContaining({ shopId: 'token-shop' }));
});
