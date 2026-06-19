const AccessAssignment = require('../../../modules/auth/models/accessAssignment.model');
const accessAssignmentRepository = require('../../../modules/auth/repositories/accessAssignment.repository');

jest.mock('../../../modules/auth/models/accessAssignment.model', () => ({
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
});
