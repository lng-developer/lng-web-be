jest.mock('../../../src/modules/auth/repositories/role.repository');
const roles = require('../../../src/modules/auth/repositories/role.repository');
const { ensureRolesExist } = require('../../../src/modules/auth/services/authAdmin.helpers');

test('role writes never overlap on the transaction session', async () => {
  const ids = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];
  const session = {};
  let active = 0;
  let peak = 0;
  roles.touchById.mockImplementation(async (id, options) => {
    expect(options.session).toBe(session);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return { _id: id };
  });
  expect(await ensureRolesExist(ids, { session, touch: true })).toEqual(ids.map((_id) => ({ _id })));
  expect(peak).toBe(1);
});
