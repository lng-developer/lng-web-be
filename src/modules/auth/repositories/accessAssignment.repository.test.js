const AccessAssignment = require('../models/accessAssignment.model');
const accessAssignmentRepository = require('./accessAssignment.repository');

jest.mock('../models/accessAssignment.model', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  findByIdAndUpdate: jest.fn(),
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

  test('findResolvedByAccountId resolves role and custom permissions into scoped permissions', async () => {
    AccessAssignment.aggregate.mockResolvedValue([]);

    await accessAssignmentRepository.findResolvedByAccountId('507f1f77bcf86cd799439011');

    const pipeline = JSON.stringify(AccessAssignment.aggregate.mock.calls[0][0]);

    expect(pipeline).toContain('rolePermissionDocs');
    expect(pipeline).toContain('customPermissionDocs');
    expect(pipeline).toContain('$setUnion');
    expect(pipeline).toContain('$toUpper');
  });
});
