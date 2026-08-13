jest.mock('../../../src/modules/chat/services/chat.service', () => ({
  createConversation: jest.fn(),
  listConversations: jest.fn(),
  listMessages: jest.fn(),
  markRead: jest.fn(),
  sendMessage: jest.fn(),
  listParticipants: jest.fn(),
}));

const controller = require('../../../src/modules/chat/controllers/chat.controller');
const service = require('../../../src/modules/chat/services/chat.service');

function response() {
  return {
    statusCode: null,
    locationValue: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    location(value) { this.locationValue = value; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('chat controller', () => {
  beforeEach(() => jest.clearAllMocks());

  test('createConversation validates body and returns Location header', async () => {
    service.createConversation.mockResolvedValue({ id: '660000000000000000000001', type: 'DIRECT' });
    const res = response();

    await controller.createConversation({
      body: {
        type: 'DIRECT',
        participantAccountIds: ['660000000000000000000002'],
      },
      auth: { accountId: '660000000000000000000003' },
    }, res);

    expect(service.createConversation).toHaveBeenCalledWith(expect.objectContaining({
      type: 'DIRECT',
      participantAccountIds: ['660000000000000000000002'],
    }), { accountId: '660000000000000000000003' });
    expect(res.statusCode).toBe(201);
    expect(res.locationValue).toBe('/api/chat/conversations/660000000000000000000001');
    expect(res.body).toEqual({ success: true, data: { id: '660000000000000000000001', type: 'DIRECT' } });
  });

  test('listParticipants validates query and returns directory', async () => {
    service.listParticipants.mockResolvedValue({ items: [{ id: '660000000000000000000002', email: 'a@lng.co' }] });
    const res = response();

    await controller.listParticipants({
      query: { search: 'a', limit: '10' },
      auth: { accountId: '660000000000000000000003' },
    }, res);

    expect(service.listParticipants).toHaveBeenCalledWith(
      { search: 'a', limit: 10 },
      { accountId: '660000000000000000000003' },
      expect.any(Set),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.items[0].email).toBe('a@lng.co');
  });

  test('sendMessage rejects empty body without assets before service work', async () => {
    await expect(controller.sendMessage({
      params: { conversationId: '660000000000000000000001' },
      body: { body: '', assetIds: [] },
      auth: { accountId: '660000000000000000000003' },
    }, response())).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(service.sendMessage).not.toHaveBeenCalled();
  });
});
