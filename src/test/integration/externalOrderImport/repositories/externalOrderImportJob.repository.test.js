const ExternalOrderImportJob = require('../../../../modules/integration/externalOrderImport/models/externalOrderImportJob.model');
const repository = require('../../../../modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository');

jest.mock('../../../../modules/integration/externalOrderImport/models/externalOrderImportJob.model', () => ({
  distinct: jest.fn(),
}));

describe('externalOrderImportJob.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('findIds filters jobs by shop IDs', async () => {
    ExternalOrderImportJob.distinct.mockResolvedValue([]);

    await repository.findIds({ shopIds: ['660000000000000000000201'] });

    expect(ExternalOrderImportJob.distinct).toHaveBeenCalledWith('_id', {
      shopId: { $in: ['660000000000000000000201'] },
    });
  });
});
