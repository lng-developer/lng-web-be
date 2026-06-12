const mongoose = require('mongoose');
const AccessAssignment = require('./accessAssignment.model');

describe('AccessAssignment model', () => {
  const accountId = new mongoose.Types.ObjectId();
  const roleId = new mongoose.Types.ObjectId();
  const teamId = new mongoose.Types.ObjectId();

  test('rejects team assignments without scopeId', async () => {
    const assignment = new AccessAssignment({
      accountId,
      roleId,
      scopeType: 'team',
      status: 'active',
    });

    await expect(assignment.validate()).rejects.toThrow('scopeId is required');
  });

  test('rejects global assignments with scopeId', async () => {
    const assignment = new AccessAssignment({
      accountId,
      roleId,
      scopeType: 'global',
      scopeId: teamId,
      status: 'active',
    });

    await expect(assignment.validate()).rejects.toThrow('scopeId must be null');
  });

  test('accepts valid scoped assignments', async () => {
    const assignment = new AccessAssignment({
      accountId,
      roleId,
      scopeType: 'team',
      scopeId: teamId,
      status: 'active',
    });

    await expect(assignment.validate()).resolves.toBeUndefined();
  });
});
