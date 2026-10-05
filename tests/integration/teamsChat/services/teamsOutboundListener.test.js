jest.mock('../../../../src/modules/chat/public', () => {
  const EventEmitter = require('events');
  return {
    chatEvents: new EventEmitter(),
  };
});

jest.mock('../../../../src/modules/integration/teamsChat/services/teamsSync.service', () => ({
  dispatchMessageToTeams: jest.fn(),
}));

const chatPublic = require('../../../../src/modules/chat/public');
const teamsSyncService = require('../../../../src/modules/integration/teamsChat/services/teamsSync.service');
const teamsOutboundListener = require('../../../../src/modules/integration/teamsChat/services/teamsOutboundListener');

describe('Teams outbound listener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teamsOutboundListener.detachTeamsOutboundListener();
  });

  afterEach(() => {
    teamsOutboundListener.detachTeamsOutboundListener();
  });

  test('calls dispatchMessageToTeams when message.created event is emitted for DIRECT conversation', async () => {
    teamsOutboundListener.attachTeamsOutboundListener();

    const conversation = { id: 'conv-1', type: 'DIRECT' };
    const message = { id: 'msg-1', body: 'Test text' };

    chatPublic.chatEvents.emit('message.created', { conversation, message });

    await new Promise((resolve) => setImmediate(resolve));

    expect(teamsSyncService.dispatchMessageToTeams).toHaveBeenCalledWith({ conversation, message });
  });

  test('ignores message.created event for non-DIRECT conversation', async () => {
    teamsOutboundListener.attachTeamsOutboundListener();

    const conversation = { id: 'conv-group-1', type: 'TEAM' };
    const message = { id: 'msg-2', body: 'Team text' };

    chatPublic.chatEvents.emit('message.created', { conversation, message });

    await new Promise((resolve) => setImmediate(resolve));

    expect(teamsSyncService.dispatchMessageToTeams).not.toHaveBeenCalled();
  });

  test('does not throw when dispatchMessageToTeams rejects', async () => {
    teamsOutboundListener.attachTeamsOutboundListener();
    teamsSyncService.dispatchMessageToTeams.mockRejectedValue(new Error('Network error'));

    const conversation = { id: 'conv-1', type: 'DIRECT' };
    const message = { id: 'msg-3', body: 'Test' };

    expect(() => {
      chatPublic.chatEvents.emit('message.created', { conversation, message });
    }).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));
    expect(teamsSyncService.dispatchMessageToTeams).toHaveBeenCalled();
  });
});
