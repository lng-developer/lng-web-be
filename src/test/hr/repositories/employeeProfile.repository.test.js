jest.mock('../../../modules/hr/models/employeeProfile.model', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));

const EmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');
const repository = require('../../../modules/hr/repositories/employeeProfile.repository');

describe('employeeProfile repository', () => {
  test('normalizes employee code when finding an active profile', async () => {
    const lean = jest.fn().mockResolvedValue({ employeeCode: 'J2501' });
    const session = jest.fn().mockReturnValue({ lean });
    EmployeeProfile.findOne.mockReturnValue({ session });

    await repository.findByEmployeeCode(' j2501 ');

    expect(EmployeeProfile.findOne).toHaveBeenCalledWith({
      employeeCode: 'J2501',
      isDeleted: false,
    });
    expect(session).toHaveBeenCalledWith(null);
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
      '_id accountId employeeCode fullName departmentId teamId status isProfileUpdated',
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

  test('updates a profile in the supplied transaction', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'profile-1' });
    EmployeeProfile.findByIdAndUpdate.mockReturnValue({ lean });

    await repository.updateById('660000000000000000000004', { teamId: null }, { session: 'session-1' });

    expect(EmployeeProfile.findByIdAndUpdate).toHaveBeenCalledWith(
      '660000000000000000000004',
      { $set: { teamId: null } },
      { returnDocument: 'after', runValidators: true, session: 'session-1' },
    );
  });

  test('touches the profile schedule lock in the supplied transaction', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: '660000000000000000000004' });
    EmployeeProfile.findByIdAndUpdate.mockReturnValue({ lean });

    await repository.touchScheduleMutation('660000000000000000000004', { session: 'session-1' });

    expect(EmployeeProfile.findByIdAndUpdate).toHaveBeenCalledWith(
      '660000000000000000000004',
      { $inc: { scheduleMutationVersion: 1 } },
      { returnDocument: 'after', session: 'session-1' },
    );
  });
});
