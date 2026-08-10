const ExternalOrderImportJob = require('../../../../src/modules/integration/externalOrderImport/models/externalOrderImportJob.model');
const repository = require('../../../../src/modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository');

jest.mock('../../../../src/modules/integration/externalOrderImport/models/externalOrderImportJob.model', () => ({
  countDocuments: jest.fn(),
  distinct: jest.fn(),
  find: jest.fn(),
}));

function mockFindChain(items = []) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(items),
  };
  ExternalOrderImportJob.find.mockReturnValue(chain);
  return chain;
}

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

  test('bulk loads only job and shop ids for issue enrichment', async () => {
    const lean = jest.fn().mockResolvedValue([
      { _id: '660000000000000000000601', shopId: '660000000000000000000201' },
    ]);
    const select = jest.fn().mockReturnValue({ lean });
    ExternalOrderImportJob.find.mockReturnValue({ select });

    const jobs = await repository.findShopIdsByIds(['660000000000000000000601']);

    expect(ExternalOrderImportJob.find).toHaveBeenCalledWith({
      _id: { $in: ['660000000000000000000601'] },
    });
    expect(select).toHaveBeenCalledWith({ _id: 1, shopId: 1 });
    expect(jobs).toHaveLength(1);
  });

  test('lists jobs inside an inclusive created-at range', async () => {
    mockFindChain();
    ExternalOrderImportJob.countDocuments.mockResolvedValue(0);

    await repository.list({
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-31T23:59:59.999Z',
      page: 1,
      limit: 20,
    });

    const filter = {
      createdAt: {
        $gte: new Date('2026-07-01T00:00:00.000Z'),
        $lte: new Date('2026-07-31T23:59:59.999Z'),
      },
    };
    expect(ExternalOrderImportJob.find).toHaveBeenCalledWith(filter);
    expect(ExternalOrderImportJob.countDocuments).toHaveBeenCalledWith(filter);
  });

  test('treats a date-only upper bound as the end of that day', async () => {
    mockFindChain();
    ExternalOrderImportJob.countDocuments.mockResolvedValue(0);

    await repository.list({ dateTo: '2026-07-31', page: 1, limit: 20 });

    expect(ExternalOrderImportJob.find).toHaveBeenCalledWith({
      createdAt: { $lte: new Date('2026-07-31T23:59:59.999Z') },
    });
  });
});
