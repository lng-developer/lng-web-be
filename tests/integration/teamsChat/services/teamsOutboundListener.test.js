jest.mock('../../../../src/modules/chat/public', () => {
  const EventEmitter = require('events');
  return {
    chatEvents: new EventEmitter(),
  };
});

jest.mock('../../../../src/modules/integration/teamsChat/services/teamsOutboundOutbox.service', () => ({
  enqueue: jest.fn(),
}));

const chatPublic = require('../../../../src/modules/chat/public');
const outboxService = require('../../../../src/modules/integration/teamsChat/services/teamsOutboundOutbox.service');
const teamsOutboundListener = require('../../../../src/modules/integration/teamsChat/services/teamsOutboundListener');

describe('Teams outbound listener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teamsOutboundListener.detachTeamsOutboundListener();
  });

  afterEach(() => {
    teamsOutboundListener.detachTeamsOutboundListener();
  });

  test('enqueues a direct Portal message without waiting for Teams Graph', async () => {
    teamsOutboundListener.attachTeamsOutboundListener();

    const conversation = { id: 'conv-1', type: 'DIRECT' };
    const message = { id: 'msg-1', body: 'Test text' };

    chatPublic.chatEvents.emit('message.created', { conversation, message });

    await new Promise((resolve) => setImmediate(resolve));

    expect(outboxService.enqueue).toHaveBeenCalledWith({ conversation, message });
  });

  test('ignores message.created event for non-DIRECT conversation', async () => {
    teamsOutboundListener.attachTeamsOutboundListener();

    const conversation = { id: 'conv-group-1', type: 'TEAM' };
    const message = { id: 'msg-2', body: 'Team text' };

    chatPublic.chatEvents.emit('message.created', { conversation, message });

    await new Promise((resolve) => setImmediate(resolve));

    expect(outboxService.enqueue).not.toHaveBeenCalled();
  });

  test('ignores message.created event when source is TEAMS_INBOUND', async () => {
    teamsOutboundListener.attachTeamsOutboundListener();

    const conversation = { id: 'conv-group-1', type: 'TEAM' };
    const message = { id: 'msg-inbound-1', body: 'Team text' };

    chatPublic.chatEvents.emit('message.created', { conversation, message, source: 'TEAMS_INBOUND' });

    await new Promise((resolve) => setImmediate(resolve));

    expect(outboxService.enqueue).not.toHaveBeenCalled();
  });

  test('does not throw when outbox enqueue rejects', async () => {
    teamsOutboundListener.attachTeamsOutboundListener();
    outboxService.enqueue.mockRejectedValue(new Error('Database error'));

    const conversation = { id: 'conv-1', type: 'DIRECT' };
    const message = { id: 'msg-3', body: 'Test' };

    expect(() => {
      chatPublic.chatEvents.emit('message.created', { conversation, message });
    }).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));
    expect(outboxService.enqueue).toHaveBeenCalled();
  });
});
