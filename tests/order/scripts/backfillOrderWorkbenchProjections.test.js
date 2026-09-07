jest.mock('../../../src/modules/order/services/orderQuery.service', () => ({ listOrderWorkbench: jest.fn() }));
jest.mock('../../../src/modules/order/services/orderWorkbenchProjection.service', () => ({ upsertOrderWorkbenchRow: jest.fn() }));
jest.mock('../../../src/modules/order/models/orderWorkbenchProjection.model', () => ({ countDocuments: jest.fn() }));

const orderQueryService = require('../../../src/modules/order/services/orderQuery.service');
const projectionService = require('../../../src/modules/order/services/orderWorkbenchProjection.service');
const OrderWorkbenchProjection = require('../../../src/modules/order/models/orderWorkbenchProjection.model');

describe('backfillOrderWorkbenchProjections', () => {
  const previousProjectionRead = process.env.ORDER_WORKBENCH_PROJECTION_READ;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ORDER_WORKBENCH_PROJECTION_READ = 'false';
  });

  afterAll(() => {
    if (previousProjectionRead === undefined) delete process.env.ORDER_WORKBENCH_PROJECTION_READ;
    else process.env.ORDER_WORKBENCH_PROJECTION_READ = previousProjectionRead;
  });

  test('writes batches and verifies persisted rows', async () => {
    orderQueryService.listOrderWorkbench.mockResolvedValueOnce({
      items: [{ order: { _id: 'order-1' } }, { order: { _id: 'order-2' } }], total: 2,
    });
    OrderWorkbenchProjection.countDocuments.mockResolvedValue(2);
    const { backfillOrderWorkbenchProjections } = require('../../../src/modules/order/scripts/backfillOrderWorkbenchProjections');

    await expect(backfillOrderWorkbenchProjections({ apply: true, batchSize: 5 })).resolves.toMatchObject({
      apply: true, total: 2, processed: 2, verified: 2, failures: [],
    });
    expect(projectionService.upsertOrderWorkbenchRow).toHaveBeenCalledTimes(2);
    expect(OrderWorkbenchProjection.countDocuments).toHaveBeenCalledWith({ orderId: { $in: ['order-1', 'order-2'] } });
  });
});
