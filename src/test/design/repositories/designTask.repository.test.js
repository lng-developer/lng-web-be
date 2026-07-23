const mockAggregate = jest.fn();

jest.mock('../../../modules/design/models/designTask.model', () => ({
  aggregate: mockAggregate,
}));

const mongoose = require('mongoose');
const repository = require('../../../modules/design/repositories/designTask.repository');

describe('designTask.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('buildFilter supports UI search, dates, priority, and listing PSD status', () => {
    const taskId = '660000000000000000510001';
    const filter = repository.buildFilter({
      search: taskId,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-14',
      priority: 'HIGH',
      psdStatus: 'MISSING',
    });

    expect(filter.priority).toBe('HIGH');
    expect(filter['listingSnapshot.psdStatus']).toBe('MISSING');
    expect(filter.createdAt).toMatchObject({
      $gte: new Date('2026-07-01'),
      $lte: new Date('2026-07-14'),
    });
    expect(filter.$or).toEqual(expect.arrayContaining([
      { _id: new mongoose.Types.ObjectId(taskId) },
      expect.objectContaining({ 'listingSnapshot.asin': expect.any(RegExp) }),
      expect.objectContaining({ 'listingSnapshot.sku': expect.any(RegExp) }),
      expect.objectContaining({ 'listingSnapshot.title': expect.any(RegExp) }),
    ]));
  });

  test('buildSort only allows known fields and defaults to updatedAt desc', () => {
    expect(repository.buildSort({ sortBy: 'createdAt', sortOrder: 'asc' })).toEqual({ createdAt: 1, _id: 1 });
    expect(repository.buildSort({ sortBy: 'bad', sortOrder: 'asc' })).toEqual({ updatedAt: -1, _id: -1 });
  });

  test('listPsdFileLinks enforces PSD_TEMPLATE and paginates flattened file roles in the database', async () => {
    mockAggregate.mockResolvedValue([{ items: [], total: [{ count: 0 }] }]);

    await repository.listPsdFileLinks({ role: 'APPROVED', page: 2, limit: 10 });

    const pipeline = mockAggregate.mock.calls[0][0];
    const serialized = JSON.stringify(pipeline);
    const facet = pipeline.find((stage) => stage.$facet).$facet;
    expect(pipeline[0].$match).toMatchObject({ taskType: 'PSD_TEMPLATE' });
    expect(serialized).toContain('REFERENCE');
    expect(serialized).toContain('SUBMISSION');
    expect(serialized).toContain('APPROVED');
    expect(facet).toEqual(expect.objectContaining({
      items: expect.any(Array),
      total: [{ $count: 'count' }],
    }));
    expect(serialized).toContain('$skip');
    expect(serialized).toContain('$limit');
  });

  test('listPsdFileLinks filters and stably sorts createdAt by the link relationship date', async () => {
    mockAggregate.mockResolvedValue([{ items: [], total: [{ count: 0 }] }]);

    await repository.listPsdFileLinks({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-14',
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });

    let pipeline = mockAggregate.mock.calls[0][0];
    let serialized = JSON.stringify(pipeline);
    let sort = pipeline.find((stage) => stage.$facet).$facet.items[0].$sort;
    const unwindIndex = pipeline.findIndex((stage) => stage.$unwind === '$fileLinks');
    const linkDateMatchIndex = pipeline.findIndex(
      (stage) => stage.$match?.['fileLinks.linkedAt'],
    );
    expect(pipeline[0].$match).not.toHaveProperty('createdAt');
    expect(linkDateMatchIndex).toBeGreaterThan(unwindIndex);
    expect(pipeline[linkDateMatchIndex].$match['fileLinks.linkedAt']).toEqual({
      $gte: new Date('2026-07-01'),
      $lte: new Date('2026-07-14T23:59:59.999Z'),
    });
    expect(serialized).toContain('linkIdentity');
    expect(serialized).toContain('$fileLinks.assetId');
    expect(serialized).toContain('$fileLinks.role');
    expect(serialized).toContain('$fileLinks.submissionId');
    expect(sort).toEqual({ 'fileLinks.linkedAt': 1, _id: 1, linkIdentity: 1 });

    mockAggregate.mockClear();
    mockAggregate.mockResolvedValue([{ items: [], total: [{ count: 0 }] }]);
    await repository.listPsdFileLinks({ sortBy: 'submittedAt', sortOrder: 'asc' });

    pipeline = mockAggregate.mock.calls[0][0];
    sort = pipeline.find((stage) => stage.$facet).$facet.items[0].$sort;
    expect(sort).toEqual({ 'fileLinks.linkedAt': 1, _id: 1, linkIdentity: 1 });
  });

  test('listPsdFileLinks searches by normalized task reference without projecting it', async () => {
    const taskId = '660000000000000000510001';
    mockAggregate.mockResolvedValue([{ items: [], total: [{ count: 0 }] }]);

    await repository.listPsdFileLinks({ search: `  ${taskId}  ` });

    const pipeline = mockAggregate.mock.calls[0][0];
    const searchMatch = pipeline.find((stage) => stage.$match?.$or).$match;
    expect(searchMatch.$or).toEqual(expect.arrayContaining([
      { _id: new mongoose.Types.ObjectId(taskId) },
    ]));
    expect(pipeline.some((stage) => stage.$set?.taskReference)).toBe(false);
  });
});
