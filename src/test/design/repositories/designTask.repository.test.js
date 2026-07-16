const mongoose = require('mongoose');
const repository = require('../../../modules/design/repositories/designTask.repository');

describe('designTask.repository', () => {
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
});
