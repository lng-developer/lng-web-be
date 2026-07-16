const ExternalOrderRawRecord = require('../../../../modules/integration/externalOrderImport/models/externalOrderRawRecord.model');
const repository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderRawRecord.repository');

jest.mock('../../../../modules/integration/externalOrderImport/models/externalOrderRawRecord.model', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

function mockFindChain(items = []) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(items),
  };
  ExternalOrderRawRecord.find.mockReturnValue(chain);
  return chain;
}

describe('externalOrderRawRecord.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('listByJob paginates raw records by job and filters post-import status', async () => {
    const chain = mockFindChain([{ _id: 'raw-id' }]);
    ExternalOrderRawRecord.countDocuments.mockResolvedValue(1);

    const result = await repository.listByJob('job-id', {
      page: 2,
      limit: 5,
      importStatus: 'FAILED',
      postImportStatus: 'QUEUED',
    });

    expect(ExternalOrderRawRecord.find).toHaveBeenCalledWith({
      importJobId: 'job-id',
      importStatus: 'FAILED',
      postImportStatus: 'QUEUED',
    });
    expect(chain.sort).toHaveBeenCalledWith({ rowNumber: 1, _id: 1 });
    expect(chain.skip).toHaveBeenCalledWith(5);
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(result).toEqual({ items: [{ _id: 'raw-id' }], total: 1, page: 2, limit: 5 });
  });

  test('updatePostImportResult can increment attempts', async () => {
    ExternalOrderRawRecord.findByIdAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: 'raw-id' }),
    });

    await repository.updatePostImportResult('raw-id', { postImportStatus: 'PROCESSING' }, { incrementAttempts: true });

    expect(ExternalOrderRawRecord.findByIdAndUpdate).toHaveBeenCalledWith(
      'raw-id',
      {
        $set: { postImportStatus: 'PROCESSING' },
        $inc: { postImportAttempts: 1 },
      },
      { returnDocument: 'after', runValidators: true },
    );
  });
});
