const mongoose = require('mongoose');
const Account = require('../../../../src/modules/auth/models/account.model');
const EmployeeProfile = require('../../../../src/modules/hr/models/employeeProfile.model');
const { parseArgs, removeUserProfiles } = require('../../../../tools/scripts/maintenance/removeUserProfiles');

jest.mock('../../../../src/modules/auth/models/account.model');
jest.mock('../../../../src/modules/hr/models/employeeProfile.model');

describe('removeUserProfiles', () => {
  const collection = { countDocuments: jest.fn() };
  const database = {
    collection: jest.fn(() => collection),
    dropCollection: jest.fn(),
    listCollections: jest.fn(() => ({ hasNext: jest.fn().mockResolvedValue(true) })),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(mongoose.connection, 'db', {
      configurable: true,
      value: database,
    });
    Account.countDocuments.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    EmployeeProfile.distinct.mockResolvedValue(['account-1', 'account-2']);
    collection.countDocuments.mockResolvedValue(2);
    database.dropCollection.mockResolvedValue(true);
  });

  test('defaults to a non-destructive dry-run', async () => {
    await expect(removeUserProfiles()).resolves.toEqual({
      mode: 'dry-run', accounts: 3, hrProfiles: 2, accountsWithoutHrProfile: 1,
      legacyProfiles: 2, legacyCollectionExists: true, collectionDropped: false,
    });
    expect(database.dropCollection).not.toHaveBeenCalled();
    expect(parseArgs([])).toEqual({ apply: false });
  });

  test('drops only the legacy collection with explicit apply', async () => {
    await expect(removeUserProfiles({ apply: true })).resolves.toMatchObject({
      mode: 'apply', collectionDropped: true,
    });
    expect(database.dropCollection).toHaveBeenCalledWith('userprofiles');
  });

  test('treats an already missing legacy collection as an idempotent apply', async () => {
    database.listCollections.mockReturnValueOnce({ hasNext: jest.fn().mockResolvedValue(false) });

    await expect(removeUserProfiles({ apply: true })).resolves.toMatchObject({
      legacyProfiles: 0, legacyCollectionExists: false, collectionDropped: false,
    });
    expect(database.dropCollection).not.toHaveBeenCalled();
  });
});
