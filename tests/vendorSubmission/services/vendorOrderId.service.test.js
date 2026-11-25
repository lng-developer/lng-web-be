jest.mock('../../../src/modules/vendorSubmission/repositories/vendorOrderId.repository', () => ({
  listHistory: jest.fn(), nextSequence: jest.fn(),
}));
const repository = require('../../../src/modules/vendorSubmission/repositories/vendorOrderId.repository');
const { allocate } = require('../../../src/modules/vendorSubmission/services/vendorOrderId.service');

describe('vendor client order IDs', () => {
  const submission = { _id: 'new', orderId: 'order', payloadSnapshot: { orderItem: { externalOrderId: '113-ORDER' } } };
  beforeEach(() => {
    jest.resetAllMocks();
    repository.listHistory.mockResolvedValue([]);
    repository.nextSequence.mockImplementation(async (_scope, floor) => floor + 1);
  });
  test.each(['MANGOTEE', 'PRINTWAY'])('%s starts with the marketplace order ID', async (provider) => {
    expect(await allocate(submission, provider, 'vendor')).toBe('113-ORDER');
  });
  test('includes cancelled history and the manual MangoTee R2 recovery', async () => {
    repository.listHistory.mockResolvedValue([
      { vendorExternalOrderId: '113-ORDER', submitAttemptCount: 1 },
      { payloadSnapshot: { mangoteeExternalOrderId: '113-ORDER-R2' } },
    ]);
    expect(await allocate(submission, 'MANGOTEE', 'vendor')).toBe('113-ORDER-R3');
  });
  test('deduplicates bundled Printway submissions that share a vendor response ID', async () => {
    repository.listHistory.mockResolvedValue([
      { vendorExternalOrderId: 'PW-123', submitOperationKey: 'submission:a' },
      { vendorExternalOrderId: 'PW-123' },
    ]);
    expect(await allocate(submission, 'PRINTWAY', 'vendor')).toBe('113-ORDER-R2');
  });
  test('continues persisted client IDs even when Printway responds with a different ID', async () => {
    repository.listHistory.mockResolvedValue([{ payloadSnapshot: { vendorClientOrderId: '113-ORDER-R5' }, vendorExternalOrderId: 'PW-123' }]);
    expect(await allocate(submission, 'PRINTWAY', 'vendor')).toBe('113-ORDER-R6');
  });
  test('does not count the current first claim as a previous dispatch', async () => {
    repository.listHistory.mockResolvedValue([{ _id: 'new', submitAttemptCount: 1, submitOperationKey: 'submission:new' }]);
    expect(await allocate(submission, 'MANGOTEE', 'vendor')).toBe('113-ORDER');
  });
  test('counts a prior failed attempt on the same submission', async () => {
    repository.listHistory.mockResolvedValue([{ _id: 'new', submitAttemptCount: 2, submitOperationKey: 'submission:new' }]);
    expect(await allocate(submission, 'MANGOTEE', 'vendor')).toBe('113-ORDER-R2');
  });
  test('separates counters by provider and vendor owner', async () => {
    await allocate(submission, 'PRINTWAY', 'vendor-b');
    expect(repository.nextSequence).toHaveBeenCalledWith(['PRINTWAY', 'vendor-b', '113-ORDER'], 0);
  });
  test.each(['SUBMITTING', 'NEEDS_REVIEW'])('blocks a sibling dispatch while another submission is %s', async (status) => {
    repository.listHistory.mockResolvedValue([{ _id: 'primary', status, payloadSnapshot: { vendorClientOrderId: '113-ORDER' } }]);
    await expect(allocate(submission, 'MANGOTEE', 'vendor')).rejects.toMatchObject({ statusCode: 409 });
    expect(repository.nextSequence).not.toHaveBeenCalled();
  });
  test('blocks a sibling already accepted in a bundle even if its local handoff was interrupted', async () => {
    repository.listHistory.mockResolvedValue([{ _id: 'primary', status: 'SUBMITTED', payloadSnapshot: { bundledSubmissionIds: ['primary', 'new'] } }]);
    await expect(allocate(submission, 'PRINTWAY', 'vendor')).rejects.toMatchObject({ statusCode: 409 });
    expect(repository.nextSequence).not.toHaveBeenCalled();
  });
});
