const DesignTask = require('../../../modules/design/models/designTask.model');

describe('DesignTask model', () => {
  test('defaults priority to NORMAL, status to REQUESTED, and submissions to empty list', () => {
    const task = new DesignTask({
      listingId: '660000000000000000510002',
      shopId: '660000000000000000510003',
      taskType: 'PSD_TEMPLATE',
    });

    expect(task.priority).toBe('NORMAL');
    expect(task.status).toBe('REQUESTED');
    expect(task.submissions).toEqual([]);

    expect(new DesignTask({
      listingId: '660000000000000000510002',
      shopId: '660000000000000000510003',
      taskType: 'PSD_TEMPLATE',
      priority: 'URGENT',
    }).priority).toBe('URGENT');
  });
});
