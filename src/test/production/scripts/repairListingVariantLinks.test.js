jest.mock('../../../modules/production/models/productionTask.model', () => ({
  collection: { find: jest.fn() },
}));

jest.mock('../../../modules/mapping/public', () => ({
  getFulfillmentPlanForOrderItem: jest.fn(),
  recheckFulfillmentPlan: jest.fn(),
}));

const ProductionTask = require('../../../modules/production/models/productionTask.model');
const mappingPublic = require('../../../modules/mapping/public');
const { repairListingVariantLinks } = require('../../../modules/production/scripts/repairListingVariantLinks');

function mockTasks(tasks) {
  const cursor = {
    sort: jest.fn(),
    limit: jest.fn(),
    toArray: jest.fn().mockResolvedValue(tasks),
  };
  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  ProductionTask.collection.find.mockReturnValue(cursor);
  return cursor;
}

describe('repairListingVariantLinks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('dry-run reports eligible legacy tasks without invoking recheck', async () => {
    mockTasks([{ _id: 'task-1', orderItemId: 'item-1' }]);
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
      id: 'plan-1',
      status: 'READY',
      listingId: 'listing-1',
      listingVariantId: null,
    });

    const result = await repairListingVariantLinks({ dryRun: true });

    expect(result).toMatchObject({ checked: 1, eligible: 1, repaired: 0, skipped: 0, failed: 0 });
    expect(mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
  });

  test('apply rechecks mapping and records an exact variant link', async () => {
    mockTasks([{ _id: 'task-1', orderItemId: 'item-1' }]);
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
      id: 'plan-1',
      status: 'READY',
      listingId: 'listing-1',
      listingVariantId: null,
    });
    mappingPublic.recheckFulfillmentPlan.mockResolvedValue({
      id: 'plan-1',
      status: 'BLOCKED',
      listingId: 'listing-1',
      listingVariantId: 'variant-1',
      blockingReasons: ['INTERNAL_TEMPLATE_NOT_FOUND'],
    });

    const result = await repairListingVariantLinks({ dryRun: false });

    expect(mappingPublic.recheckFulfillmentPlan).toHaveBeenCalledWith(
      'item-1',
      {},
      { system: true, source: 'PRODUCTION_VARIANT_REPAIR' },
    );
    expect(result).toMatchObject({ checked: 1, eligible: 1, repaired: 1, skipped: 0, failed: 0 });
  });

  test('apply skips missing listing and unresolved variant without guessing', async () => {
    mockTasks([
      { _id: 'task-1', orderItemId: 'item-1' },
      { _id: 'task-2', orderItemId: 'item-2' },
    ]);
    mappingPublic.getFulfillmentPlanForOrderItem
      .mockResolvedValueOnce({ id: 'plan-1', listingId: null, listingVariantId: null })
      .mockResolvedValueOnce({ id: 'plan-2', listingId: 'listing-2', listingVariantId: null });
    mappingPublic.recheckFulfillmentPlan
      .mockResolvedValueOnce({ id: 'plan-1', listingId: null, listingVariantId: null, blockingReasons: ['LISTING_NOT_FOUND'] })
      .mockResolvedValueOnce({ id: 'plan-2', listingId: 'listing-2', listingVariantId: null, blockingReasons: ['LISTING_VARIANT_NOT_FOUND'] });

    const result = await repairListingVariantLinks({ dryRun: false });

    expect(result).toMatchObject({ checked: 2, eligible: 2, repaired: 0, skipped: 2, failed: 0 });
    expect(result.reasons).toMatchObject({ LISTING_NOT_FOUND: 1, LISTING_VARIANT_NOT_FOUND: 1 });
  });

  test('rerun skips tasks whose fulfillment plan already carries listingVariantId', async () => {
    mockTasks([{ _id: 'task-1', orderItemId: 'item-1' }]);
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
      id: 'plan-1',
      listingId: 'listing-1',
      listingVariantId: 'variant-1',
    });

    const result = await repairListingVariantLinks({ dryRun: false });

    expect(result).toMatchObject({ checked: 1, eligible: 0, repaired: 0, skipped: 1, failed: 0 });
    expect(result.reasons).toMatchObject({ ALREADY_LINKED: 1 });
    expect(mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
  });

  test('rerun skips plans already confirmed to have no matching listing variant', async () => {
    mockTasks([{ _id: 'task-1', orderItemId: 'item-1' }]);
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
      id: 'plan-1',
      listingId: 'listing-1',
      listingVariantId: null,
      blockingReasons: ['LISTING_VARIANT_NOT_FOUND'],
    });

    const result = await repairListingVariantLinks({ dryRun: false });

    expect(result).toMatchObject({ checked: 1, eligible: 0, repaired: 0, skipped: 1, failed: 0 });
    expect(result.reasons).toMatchObject({ LISTING_VARIANT_NOT_FOUND: 1 });
    expect(mappingPublic.recheckFulfillmentPlan).not.toHaveBeenCalled();
  });
});
