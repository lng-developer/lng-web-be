const mockAdd = jest.fn();

jest.mock('../../../src/config/queue', () => ({ createQueue: jest.fn(() => ({ add: mockAdd })) }));

const queue = require('../../../src/modules/order/services/orderRecheckJobQueue.service');

test('uses a BullMQ-compatible job id', async () => {
  mockAdd.mockResolvedValue({});

  await queue.enqueue('660000000000000000000301');

  expect(mockAdd).toHaveBeenCalledWith('recheck', { jobId: '660000000000000000000301' }, expect.objectContaining({
    jobId: 'order-recheck-660000000000000000000301',
  }));
});
