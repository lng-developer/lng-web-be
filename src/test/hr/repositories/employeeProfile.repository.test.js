jest.mock('../../../modules/hr/models/employeeProfile.model', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));

const EmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');
const repository = require('../../../modules/hr/repositories/employeeProfile.repository');

describe('employeeProfile repository', () => {
  test('normalizes employee code when finding an active profile', async () => {
    const lean = jest.fn().mockResolvedValue({ employeeCode: 'J2501' });
    EmployeeProfile.findOne.mockReturnValue({ lean });

    await repository.findByEmployeeCode(' j2501 ');

    expect(EmployeeProfile.findOne).toHaveBeenCalledWith({
      employeeCode: 'J2501',
      isDeleted: false,
    });
  });

  test('uses an explicit minimal projection for every public profile lookup', async () => {
    const lean = jest.fn().mockResolvedValue({});
    const select = jest.fn().mockReturnValue({ lean });
    EmployeeProfile.findOne.mockReturnValue({ select });
    EmployeeProfile.find.mockReturnValue({ select });

    await repository.findPublicByAccountId('account-1');
    await repository.findPublicByEmployeeCode('J2501');
    await repository.listPublicByAccountIds(['account-1']);

    expect(select).toHaveBeenCalledTimes(3);
    expect(select).toHaveBeenCalledWith(
      '_id accountId employeeCode fullName departmentId teamId status',
    );
  });

  test('lists scoped profile IDs without pagination', async () => {
    const lean = jest.fn().mockResolvedValue([{ _id: 'profile-1' }]);
    const select = jest.fn().mockReturnValue({ lean });
    EmployeeProfile.find.mockReturnValue({ select });
    const scopeFilters = [{ teamId: 'team-1' }];

    await repository.listIds({ scopeFilters });

    expect(EmployeeProfile.find).toHaveBeenCalledWith({
      isDeleted: false,
      $and: [{ $or: scopeFilters }],
    });
    expect(select).toHaveBeenCalledWith('_id');
    expect(lean).toHaveBeenCalledTimes(1);
  });
});
