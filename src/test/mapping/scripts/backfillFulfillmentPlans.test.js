jest.mock('../../../modules/order/public', () => ({ listItems: jest.fn() }));
jest.mock('../../../config/database', () => ({ connectDatabase: jest.fn(), disconnectDatabase: jest.fn() }));
jest.mock('../../../modules/mapping/services/fulfillmentPlan.service', () => ({
  listFulfillmentPlansByOrderItemIds: jest.fn(),
  recheckFulfillmentPlan: jest.fn(),
}));

const orderPublic = require('../../../modules/order/public');
const mappingService = require('../../../modules/mapping/services/fulfillmentPlan.service');

describe('backfillFulfillmentPlans', () => {
  beforeEach(() => jest.clearAllMocks());

  test('dry-run reports missing plans without resolving them', async () => {
    orderPublic.listItems.mockResolvedValueOnce({ items: [{ _id: 'item-1' }, { _id: 'item-2' }], total: 2 });
    mappingService.listFulfillmentPlansByOrderItemIds.mockResolvedValueOnce([{ orderItemId: 'item-1' }]);
    const { backfillFulfillmentPlans } = require('../../../modules/mapping/scripts/backfillFulfillmentPlans');

    await expect(backfillFulfillmentPlans({ dryRun: true, batchSize: 2 })).resolves.toMatchObject({
      dryRun: true, totalOrderItems: 2, existingPlans: 1, missingPlans: 1, processed: 0, createdOrUpdated: 0,
    });
    expect(mappingService.recheckFulfillmentPlan).not.toHaveBeenCalled();
  });

  test('write continues after an item failure and resolves only missing plans', async () => {
    orderPublic.listItems.mockResolvedValueOnce({ items: [{ _id: 'item-1' }, { _id: 'item-2' }, { _id: 'item-3' }], total: 3 });
    mappingService.listFulfillmentPlansByOrderItemIds.mockResolvedValueOnce([{ orderItemId: 'item-1' }]);
    mappingService.recheckFulfillmentPlan
      .mockRejectedValueOnce(new Error('bad item'))
      .mockResolvedValueOnce({ status: 'BLOCKED' });
    const { backfillFulfillmentPlans } = require('../../../modules/mapping/scripts/backfillFulfillmentPlans');

    const result = await backfillFulfillmentPlans({ dryRun: false, batchSize: 3 });

    expect(mappingService.recheckFulfillmentPlan).toHaveBeenCalledTimes(2);
    expect(mappingService.recheckFulfillmentPlan).toHaveBeenNthCalledWith(1, 'item-2', {}, expect.objectContaining({ system: true }));
    expect(result).toMatchObject({ missingPlans: 2, processed: 2, createdOrUpdated: 1 });
    expect(result.failures).toEqual([{ orderItemId: 'item-2', error: 'bad item' }]);
  });
});
