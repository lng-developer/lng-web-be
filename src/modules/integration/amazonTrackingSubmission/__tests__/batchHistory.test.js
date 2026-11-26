const service = require('../services/amazonTrackingSubmission.service');
const repository = require('../repositories/amazonTrackingSubmission.repository');
jest.mock('../repositories/amazonTrackingSubmission.repository');

describe('tracking batch history access', () => {
  const shopId = '507f1f77bcf86cd799439011';
  beforeEach(() => jest.clearAllMocks());
  test('filters a globally authorized reader to the requested shop and returns summaries', async () => {
    repository.listSubmissions.mockResolvedValue({ items: [{ _id: 'batch', shopId, rows: [{ secret: true }], tsv: 'large feed' }], total: 1, page: 2, limit: 10 });
    const result = await service.listSubmissions({ shopId, page: 2, limit: 10 }, { permissions: ['SHIPMENTS:READ'] });
    expect(repository.listSubmissions).toHaveBeenCalledWith({ shopIds: [shopId], page: 2, limit: 10 });
    expect(result.items[0]).toMatchObject({ id: 'batch', shopId });
    expect(result.items[0]).not.toHaveProperty('tsv');
    expect(result.items[0]).not.toHaveProperty('rows');
  });
  test('rejects a different shop', async () => {
    await expect(service.listSubmissions({ shopId }, { scopes: [{ scopeType: 'shop', scopeId: 'another', permissions: ['ORDERS:READ'] }] })).rejects.toThrow('Forbidden');
    expect(repository.listSubmissions).not.toHaveBeenCalled();
  });
  test('returns no batches for expired or missing scopes', async () => {
    const result = await service.listSubmissions({ page: 1, limit: 20 }, { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'], validUntil: '2020-01-01' }] });
    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    expect(repository.listSubmissions).not.toHaveBeenCalled();
  });
  test('restricts unfiltered history to accessible shops', async () => {
    repository.listSubmissions.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    await service.listSubmissions({ page: 1, limit: 20 }, { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:WRITE'] }] });
    expect(repository.listSubmissions).toHaveBeenCalledWith({ shopIds: [shopId], page: 1, limit: 20 });
  });
  test('detail accepts shipment readers but denies other shops', async () => {
    repository.findById.mockResolvedValue({ _id: 'batch', shopId, rows: [] });
    await expect(service.getSubmission('batch', { permissions: ['SHIPMENTS:READ'] })).resolves.toMatchObject({ id: 'batch', rows: [] });
    await expect(service.getSubmission('batch', { scopes: [] })).rejects.toThrow('Forbidden');
  });
});
