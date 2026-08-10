const mongoose = require('mongoose');
const AccessAssignment = require('../../../src/modules/auth/models/accessAssignment.model');
const accessAssignmentRepository = require('../../../src/modules/auth/repositories/accessAssignment.repository');

jest.mock('../../../src/modules/auth/models/account.model', () => ({
  collection: { name: 'accounts' },
}));

jest.mock('../../../src/modules/auth/models/accessAssignment.model', () => ({
  create: jest.fn(),
  insertMany: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateMany: jest.fn(),
  aggregate: jest.fn(),
}));

describe('accessAssignmentRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('list uses shared pagination offset and lean read model', async () => {
    const lean = jest.fn().mockResolvedValue([{ _id: 'assignment-id' }]);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    AccessAssignment.find.mockReturnValue({ sort });
    AccessAssignment.countDocuments.mockResolvedValue(1);

    const result = await accessAssignmentRepository.list({ page: 3, limit: 25, scopeType: 'team' });

    expect(AccessAssignment.find).toHaveBeenCalledWith({ scopeType: 'team' });
    expect(skip).toHaveBeenCalledWith(50);
    expect(result).toEqual({
      items: [{ _id: 'assignment-id' }],
      total: 1,
      page: 3,
      limit: 25,
    });
  });

  test('update runs schema validators', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'assignment-id' });
    AccessAssignment.findByIdAndUpdate.mockReturnValue({ lean });

    await accessAssignmentRepository.update('507f1f77bcf86cd799439099', {
      scopeType: 'team',
      scopeId: '507f1f77bcf86cd799439088',
    });

    expect(AccessAssignment.findByIdAndUpdate).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439099',
      {
        $set: {
          scopeType: 'team',
          scopeId: '507f1f77bcf86cd799439088',
        },
      },
      { returnDocument: 'after', runValidators: true },
    );
  });

  test('hasOtherActiveGlobalRoleAccount requires an active account', async () => {
    const session = jest.fn().mockResolvedValue([{ _id: 'assignment-id' }]);
    AccessAssignment.aggregate.mockReturnValue({ session });

    const result = await accessAssignmentRepository.hasOtherActiveGlobalRoleAccount(
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439012',
      { session: 'session' },
    );

    expect(result).toBe(true);
    expect(AccessAssignment.aggregate).toHaveBeenCalledWith([
      {
        $match: {
          roleId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
          accountId: { $ne: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012') },
          scopeType: 'global',
          scopeId: null,
          status: 'active',
        },
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'accountId',
          foreignField: '_id',
          as: 'account',
        },
      },
      { $match: { 'account.status': 'active' } },
      { $limit: 1 },
    ]);
    expect(session).toHaveBeenCalledWith('session');
  });
});
