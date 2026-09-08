jest.mock('../../../src/config/queue', () => ({
  createQueue: jest.fn(),
}));

jest.mock('../../../src/config', () => ({
  redis: { enabled: true },
}));

const { createQueue } = require('../../../src/config/queue');
const { enqueueFinanceImport } = require('../../../src/modules/finance/services/financeImportQueue.service');

describe('financeImportQueue.service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    createQueue.mockReturnValue({ add: jest.fn().mockResolvedValue({ id: 'finance-import-abc' }) });
  });

  test('enqueues one deterministic job per import batch', async () => {
    const result = await enqueueFinanceImport({ batchId: 'abc' });

    expect(createQueue).toHaveBeenCalledWith('finance-import');
    expect(result).toEqual({ queued: true, jobId: 'finance-import-abc' });
  });
});
