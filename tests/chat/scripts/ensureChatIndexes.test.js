jest.mock('../../../src/config/database', () => ({
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
}));

jest.mock('../../../src/shared/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../../src/modules/chat/models/message.model', () => ({
  createIndexes: jest.fn(),
}));

const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const Message = require('../../../src/modules/chat/models/message.model');
const { ensureChatIndexes } = require('../../../src/modules/chat/scripts/ensureChatIndexes');

describe('ensureChatIndexes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates message indexes and closes the managed database connection', async () => {
    Message.createIndexes.mockResolvedValue(['idempotencyKey_1']);

    await expect(ensureChatIndexes()).resolves.toEqual(['idempotencyKey_1']);

    expect(connectDatabase).toHaveBeenCalledTimes(1);
    expect(Message.createIndexes).toHaveBeenCalledTimes(1);
    expect(disconnectDatabase).toHaveBeenCalledTimes(1);
  });
});
