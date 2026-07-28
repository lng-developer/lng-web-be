const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Department = require('../../../modules/organization/models/department.model');
const Team = require('../../../modules/organization/models/team.model');
const departmentRepository = require('../../../modules/organization/repositories/department.repository');
const teamRepository = require('../../../modules/organization/repositories/team.repository');

describe('legacy organization migration resolution', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { dbName: 'legacy_organization_resolution_test' } });
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([Department.deleteMany({}), Team.deleteMany({})]);
  });

  it('maps a legacy department and team code to their actual target ids', async () => {
    const sourceDepartmentId = new mongoose.Types.ObjectId();
    const sourceTeamId = new mongoose.Types.ObjectId();
    const targetDepartment = await Department.create({ name: 'Engineering', code: 'ENG', status: 'active' });
    const targetTeam = await Team.create({ name: 'Platform', code: 'PLATFORM', departmentId: targetDepartment._id, status: 'active' });

    const departments = await departmentRepository.resolveLegacyDepartments([{
      _id: sourceDepartmentId,
      name: 'Engineering Legacy',
      code: 'ENG',
      status: 'active',
    }]);
    const teams = await teamRepository.resolveLegacyTeams([{
      _id: sourceTeamId,
      name: 'Platform Legacy',
      code: 'PLATFORM',
      departmentId: targetDepartment._id,
      status: 'active',
    }]);

    expect(departments.skippedRows).toEqual([]);
    expect(departments.mappings).toEqual([{ sourceId: String(sourceDepartmentId), targetId: String(targetDepartment._id) }]);
    expect(departments.items[0]._id).toEqual(targetDepartment._id);
    expect(teams.skippedRows).toEqual([]);
    expect(teams.mappings).toEqual([{ sourceId: String(sourceTeamId), targetId: String(targetTeam._id) }]);
    expect(teams.items[0]._id).toEqual(targetTeam._id);
  });

  it('reports a source id already owned by a different target code', async () => {
    const sourceDepartmentId = new mongoose.Types.ObjectId();
    await Department.create({ _id: sourceDepartmentId, name: 'Sales', code: 'SALES', status: 'active' });

    const result = await departmentRepository.resolveLegacyDepartments([{
      _id: sourceDepartmentId,
      name: 'Engineering',
      code: 'ENG',
      status: 'active',
    }]);

    expect(result.items).toEqual([]);
    expect(result.mappings).toEqual([]);
    expect(result.skippedRows).toEqual([{
      sourceId: String(sourceDepartmentId),
      reasonCode: 'DEPARTMENT_SOURCE_ID_COLLISION',
    }]);
  });
});
