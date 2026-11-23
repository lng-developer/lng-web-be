jest.mock('../../../src/modules/audit/public', () => ({ record: jest.fn() }));
const audit = require('../../../src/modules/audit/public');
const { recordDesignOperation } = require('../../../src/modules/design/services/designOperationAudit.service');

test.each([
  [{ system: true, source: 'DESIGN_TASK' }, 'SYSTEM'],
  [{ worker: true, source: 'DESIGN_WORKER' }, 'WORKER'],
  [{ import: true }, 'IMPORT'],
  [{ source: 'HTTP' }, 'HTTP'],
  [{ source: 'WORKER' }, 'WORKER'],
  [{}, 'HTTP'],
])('records a valid audit source for %j', async (authContext, source) => {
  audit.record.mockResolvedValue({ id: 'audit' });
  await expect(recordDesignOperation({ action: 'DESIGN_TASK_CREATED', entityId: 'task', authContext }))
    .resolves.toEqual({ id: 'audit' });
  expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ source }));
});
