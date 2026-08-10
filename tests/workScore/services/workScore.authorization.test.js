const mockRepository = {
  adjust: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  summarize: jest.fn(),
};

jest.mock('../../../src/modules/workScore/repositories/workScore.repository', () => mockRepository);

const service = require('../../../src/modules/workScore/services/workScore.service');

const shopOne = '660000000000000000000001';
const shopTwo = '660000000000000000000002';
const worker = '660000000000000000000003';

describe('workScore authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository.list.mockResolvedValue({ items: [], total: 0 });
    mockRepository.summarize.mockResolvedValue({ totalPoints: 0, totalFiles: 0 });
  });

  test('global reader can query all shops', async () => {
    await service.listScores({}, { permissions: ['WORK_SCORES:READ'] });
    expect(mockRepository.list).toHaveBeenCalledWith({});
  });

  test('adjust permission also grants the read needed by the adjustment workspace', async () => {
    await service.listScores({}, { permissions: ['WORK_SCORES:ADJUST'] });
    expect(mockRepository.list).toHaveBeenCalledWith({});
  });

  test('scoped reader is restricted to exact shops and cross-shop query is denied', async () => {
    const auth = { scopes: [{ scopeType: 'shop', scopeId: shopOne, permissions: ['WORK_SCORES:READ'] }] };
    await service.listScores({}, auth);
    expect(mockRepository.list).toHaveBeenCalledWith({ shopIds: [shopOne] });
    await expect(service.listScores({ shopId: shopTwo }, auth)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('DESIGN:WORK is self-only and shop-scoped', async () => {
    const auth = {
      accountId: worker,
      scopes: [{ scopeType: 'shop', scopeId: shopOne, permissions: ['DESIGN:WORK'] }],
    };
    await service.summarizeScores({}, auth);
    expect(mockRepository.summarize).toHaveBeenCalledWith({ workerId: worker, shopIds: [shopOne] });
  });

  test('detail and adjustment repeat exact shop authorization', async () => {
    mockRepository.findById.mockResolvedValue({ _id: 'score-id', shopId: shopTwo, workerId: worker, status: 'ACTIVE' });
    const auth = { scopes: [{ scopeType: 'shop', scopeId: shopOne, permissions: ['WORK_SCORES:ADJUST'] }] };
    await expect(service.voidScore('score-id', { reason: 'Duplicate', expectedVersion: 0 }, auth))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
