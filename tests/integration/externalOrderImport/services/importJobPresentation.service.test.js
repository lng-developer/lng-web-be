jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository', () => ({ summarizeOutcomes: jest.fn() }));
jest.mock('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository', () => ({ summarizeOpenIssues: jest.fn() }));
const raw = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository');
const issues = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository');
const { enrichJobs } = require('../../../../src/modules/integration/externalOrderImport/services/importJobPresentation.service');
test('keeps legacy counts unknown and separates address issues from imported rows', async () => {
  raw.summarizeOutcomes.mockResolvedValue([{ _id: 'new', createdOrders: 0, updatedOrders: 5, unknownOrders: 0 }, { _id: 'old', createdOrders: 0, updatedOrders: 0, unknownOrders: 5 }]);
  issues.summarizeOpenIssues.mockResolvedValue([{ _id: 'new', openIssues: 4, addressIssues: 4 }]);
  const result = await enrichJobs([{ _id: 'new', importedCount: 5 }, { _id: 'old', importedCount: 5 }]);
  expect(result[0].resultSummary).toEqual({ createdOrders: 0, updatedOrders: 5, openIssues: 4, addressIssues: 4 });
  expect(result[1].resultSummary.createdOrders).toBeNull();
  expect(result[1].resultSummary.updatedOrders).toBeNull();
});
