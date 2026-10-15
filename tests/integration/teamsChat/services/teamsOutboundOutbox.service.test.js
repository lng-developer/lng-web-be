jest.mock('../../../../src/modules/integration/teamsChat/repositories/teamsOutboundMessage.repository', () => ({
  enqueue: jest.fn(), claimDue: jest.fn(), markSent: jest.fn(), retry: jest.fn(), fail: jest.fn(),
}));
jest.mock('../../../../src/modules/integration/teamsChat/services/teamsSync.service', () => ({ dispatchMessageToTeams: jest.fn() }));

const repository = require('../../../../src/modules/integration/teamsChat/repositories/teamsOutboundMessage.repository');
const teamsSync = require('../../../../src/modules/integration/teamsChat/services/teamsSync.service');
const service = require('../../../../src/modules/integration/teamsChat/services/teamsOutboundOutbox.service');

describe('Teams outbound outbox', () => {
  beforeEach(() => jest.clearAllMocks());
  test('creates one idempotent job for a direct Portal message', async () => {
    await service.enqueue({ conversation: { id: 'conv-1', type: 'DIRECT', participantAccountIds: ['a', 'b'] }, message: { id: 'msg-1', body: 'hello', senderAccountId: 'a' } });
    expect(repository.enqueue).toHaveBeenCalledWith(expect.objectContaining({ lngMessageId: 'msg-1', conversationId: 'conv-1', body: 'hello' }));
  });
  test('marks a successful Graph dispatch sent', async () => {
    repository.claimDue.mockResolvedValueOnce({ id: 'job-1', conversation: { id: 'conv-1', type: 'DIRECT' }, message: { id: 'msg-1', body: 'hello' } }).mockResolvedValueOnce(null);
    teamsSync.dispatchMessageToTeams.mockResolvedValue({ status: 'SYNCED' });
    await service.processDue();
    expect(repository.markSent).toHaveBeenCalledWith('job-1');
  });
  test('backs off transient failures instead of blocking chat', async () => {
    repository.claimDue.mockResolvedValueOnce({ id: 'job-1', attempts: 0, conversation: { id: 'conv-1', type: 'DIRECT' }, message: { id: 'msg-1', body: 'hello' } }).mockResolvedValueOnce(null);
    teamsSync.dispatchMessageToTeams.mockResolvedValue({ status: 'FAILED', error: 'timeout' });
    await service.processDue();
    expect(repository.retry).toHaveBeenCalledWith('job-1', expect.any(Date), 'timeout');
  });
});
