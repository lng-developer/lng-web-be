const mockServerEvents = {};
const mockSocketEvents = {};
const mockSocketRooms = new Set();
const mockEmit = jest.fn();
const mockToEmit = jest.fn();
const mockClose = jest.fn();

jest.mock('socket.io', () => ({
  Server: jest.fn().mockImplementation(() => ({
    use(fn) { mockServerEvents.middleware = fn; },
    on(event, fn) { mockServerEvents[event] = fn; },
    to(room) {
      return {
        emit(event, payload) {
          mockToEmit(room, event, payload);
        },
      };
    },
    close: mockClose,
  })),
}));

jest.mock('../../../src/config', () => ({
  http: { corsOrigins: ['http://localhost:5173'] },
  env: 'test',
  log: { level: 'silent', format: 'json' },
}));

jest.mock('../../../src/modules/auth/public', () => ({
  verifyAccessToken: jest.fn(),
  getCurrentAccount: jest.fn(),
  buildAuthContext: jest.fn(),
}));

jest.mock('../../../src/modules/chat/services/chat.service', () => ({
  listMessages: jest.fn(),
  sendMessage: jest.fn(),
  markRead: jest.fn(),
}));

const authPublic = require('../../../src/modules/auth/public');
const chatService = require('../../../src/modules/chat/services/chat.service');
const chatEvents = require('../../../src/modules/chat/events');
const presenceRegistry = require('../../../src/realtime/presenceRegistry');
const { attachChatSocket } = require('../../../src/realtime/chatSocket');

function fakeSocket() {
  return {
    handshake: { auth: { token: 'access-token' }, headers: {} },
    authContext: null,
    join(room) { mockSocketRooms.add(room); },
    on(event, fn) { mockSocketEvents[event] = fn; },
    to(room) {
      return {
        emit(event, payload) {
          mockEmit(room, event, payload);
        },
      };
    },
  };
}

describe('chat socket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockServerEvents).forEach((key) => delete mockServerEvents[key]);
    Object.keys(mockSocketEvents).forEach((key) => delete mockSocketEvents[key]);
    mockSocketRooms.clear();
    chatEvents.removeAllListeners('message.created');
    presenceRegistry.reset();
    authPublic.verifyAccessToken.mockReturnValue({ sub: '660000000000000000000001', tokenVersion: 2 });
    authPublic.getCurrentAccount.mockResolvedValue({ account: { _id: '660000000000000000000001' } });
    authPublic.buildAuthContext.mockReturnValue({ accountId: '660000000000000000000001' });
    chatService.listMessages.mockResolvedValue({ items: [] });
    chatService.sendMessage.mockResolvedValue({ id: '660000000000000000000011', body: 'hello' });
    chatService.markRead.mockResolvedValue({
      conversationId: '660000000000000000000010',
      accountId: '660000000000000000000001',
    });
  });

  test('authenticates socket token and registers chat events', async () => {
    attachChatSocket({});
    const socket = fakeSocket();
    const next = jest.fn();

    await mockServerEvents.middleware(socket, next);
    mockServerEvents.connection(socket);

    expect(authPublic.verifyAccessToken).toHaveBeenCalledWith('access-token');
    expect(authPublic.getCurrentAccount).toHaveBeenCalledWith('660000000000000000000001', 2);
    expect(socket.authContext).toEqual({ accountId: '660000000000000000000001' });
    expect(mockSocketRooms.has('account:660000000000000000000001')).toBe(true);
    expect(next).toHaveBeenCalledWith();
    expect(Object.keys(mockSocketEvents).sort()).toEqual([
      'conversation.join',
      'disconnect',
      'message.read',
      'message.send',
      'typing',
    ]);
  });

  test.each(['passwordSetupRequired', 'mustChangePassword'])('rejects a socket while %s is required', async (flag) => {
    authPublic.buildAuthContext.mockReturnValue({ accountId: 'account-1', [flag]: true });
    attachChatSocket({});
    const next = jest.fn();
    await mockServerEvents.middleware(fakeSocket(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Account setup required' }));
  });

  test('broadcasts account presence on connect and disconnect', async () => {
    attachChatSocket({});
    const socket = fakeSocket();
    await mockServerEvents.middleware(socket, jest.fn());
    mockServerEvents.connection(socket);

    expect(mockToEmit).toHaveBeenCalledWith('presence', 'presence.changed', {
      accountId: '660000000000000000000001',
      presence: 'ONLINE',
    });

    mockSocketEvents.disconnect();

    expect(mockToEmit).toHaveBeenCalledWith('presence', 'presence.changed', {
      accountId: '660000000000000000000001',
      presence: 'OFFLINE',
    });
  });

  test('join/send/read emit room events and ack success', async () => {
    attachChatSocket({});
    const socket = fakeSocket();
    await mockServerEvents.middleware(socket, jest.fn());
    mockServerEvents.connection(socket);

    const joinAck = jest.fn();
    await mockSocketEvents['conversation.join']({ conversationId: '660000000000000000000010' }, joinAck);
    const sendAck = jest.fn();
    await mockSocketEvents['message.send']({
      conversationId: '660000000000000000000010',
      body: 'hello',
    }, sendAck);
    const readAck = jest.fn();
    await mockSocketEvents['message.read']({ conversationId: '660000000000000000000010' }, readAck);
    mockSocketEvents.typing({ conversationId: '660000000000000000000010', isTyping: true });

    expect(mockSocketRooms.has('conversation:660000000000000000000010')).toBe(true);
    expect(joinAck).toHaveBeenCalledWith({ ok: true });
    chatEvents.emit('message.read', {
      conversationId: '660000000000000000000010', accountId: '660000000000000000000001', lastReadAt: new Date(),
    });
    expect(mockToEmit).toHaveBeenCalledWith(
      ['account:660000000000000000000001', 'conversation:660000000000000000000010'],
      'message.read',
      expect.objectContaining({ accountId: '660000000000000000000001' }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      'conversation:660000000000000000000010',
      'typing',
      { conversationId: '660000000000000000000010', accountId: '660000000000000000000001', isTyping: true },
    );
    expect(sendAck).toHaveBeenCalledWith({ ok: true, message: { id: '660000000000000000000011', body: 'hello' } });
    expect(readAck).toHaveBeenCalledWith({ ok: true, state: expect.objectContaining({ accountId: '660000000000000000000001' }) });
  });

  test('broadcasts created messages to participant account rooms', async () => {
    const io = attachChatSocket({});

    chatEvents.emit('message.created', {
      conversation: {
        id: '660000000000000000000010',
        participantAccountIds: ['660000000000000000000001', '660000000000000000000002'],
      },
      message: {
        id: '660000000000000000000011',
        conversationId: '660000000000000000000010',
        body: 'hello',
      },
    });

    expect(mockToEmit).toHaveBeenCalledWith(
      'account:660000000000000000000001',
      'message.created',
      expect.objectContaining({ message: expect.objectContaining({ body: 'hello' }) }),
    );
    expect(mockToEmit).toHaveBeenCalledWith(
      'account:660000000000000000000002',
      'message.created',
      expect.objectContaining({ message: expect.objectContaining({ body: 'hello' }) }),
    );

    io.close();
  });
});
