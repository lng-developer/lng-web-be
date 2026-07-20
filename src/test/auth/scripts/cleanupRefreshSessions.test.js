const {
  DEFAULT_MAX_SESSIONS,
  cleanup,
  parseArgs,
} = require('../../../modules/auth/scripts/cleanupRefreshSessions');

const Account = require('../../../modules/auth/models/account.model');

jest.mock('../../../modules/auth/models/account.model', () => ({
  aggregate: jest.fn(),
  updateMany: jest.fn(),
}));

describe('cleanupRefreshSessions script', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('defaults to dry-run with the session cap', () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      max: DEFAULT_MAX_SESSIONS,
    });
  });

  test('parses apply mode and custom max', () => {
    expect(parseArgs(['--apply', '--max=20'])).toEqual({
      apply: true,
      max: 20,
    });
  });

  test('rejects invalid max', () => {
    expect(() => parseArgs(['--max=0'])).toThrow('--max must be a positive integer');
  });

  test('apply uses a Mongo update pipeline', async () => {
    Account.aggregate
      .mockResolvedValueOnce([{ sessionsBefore: 2, sessionsAfter: 1 }])
      .mockResolvedValueOnce([{ sessionsBefore: 1, sessionsAfter: 1 }]);
    Account.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await cleanup({ apply: true, max: 50 });

    expect(Account.updateMany.mock.calls[0][2]).toEqual({ updatePipeline: true });
  });
});
