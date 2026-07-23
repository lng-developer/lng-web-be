const ExternalOrderImportIssue = require('../../../../modules/integration/externalOrderImport/models/externalOrderImportIssue.model');
const repository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository');

jest.mock('../../../../modules/integration/externalOrderImport/models/externalOrderImportIssue.model', () => ({
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
  ExternalOrderImportIssue.find.mockReturnValue(chain);
  return chain;
}

describe('externalOrderImportIssue.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lists issues only from the supplied import jobs', async () => {
    mockFindChain();
    ExternalOrderImportIssue.countDocuments.mockResolvedValue(0);
    const filter = {
      importJobId: {
        $in: [
          '660000000000000000000601',
          '660000000000000000000602',
        ],
      },
    };

    await repository.list({
      importJobIds: [
        '660000000000000000000601',
        '660000000000000000000602',
      ],
      page: 1,
      limit: 20,
    });

    expect(ExternalOrderImportIssue.find).toHaveBeenCalledWith(filter);
    expect(ExternalOrderImportIssue.countDocuments).toHaveBeenCalledWith(filter);
  });
});
