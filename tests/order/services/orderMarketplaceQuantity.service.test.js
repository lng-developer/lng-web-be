jest.mock('../../../src/modules/order/repositories/orderItem.repository', () => ({ findByIds: jest.fn() }));
jest.mock('../../../src/modules/order/repositories/orderTimeline.repository', () => ({ listQuantityUpdates: jest.fn() }));

const items = require('../../../src/modules/order/repositories/orderItem.repository');
const timeline = require('../../../src/modules/order/repositories/orderTimeline.repository');
const service = require('../../../src/modules/order/services/orderMarketplaceQuantity.service');
const payloads = require('../../../src/modules/order/services/orderImport.payloads');

beforeEach(() => jest.resetAllMocks());

test('import creation and reimport retain marketplace quantity separately', () => {
  const item = { externalItemId: 'line-1', quantity: 2 };
  expect(payloads.buildItemCreatePayload(item, {}, {}, 'order-1', [], new Date()))
    .toMatchObject({ quantity: 2, marketplaceQuantity: 2 });
  expect(payloads.buildItemUpdatePayload(item, {}, new Date(), []).set)
    .toMatchObject({ quantity: 2, marketplaceQuantity: 2 });
});

test('confirmation resolves only legacy overrides in one history read', async () => {
  items.findByIds.mockResolvedValue([
    { _id: 'untouched', quantity: 1 },
    { _id: 'saved', quantity: 3, quantityOverride: 3, marketplaceQuantity: 1 },
    { _id: 'unknown', quantity: 4, quantityOverride: 4, marketplaceQuantity: null },
    { _id: 'legacy', quantity: 5, quantityOverride: 5 },
  ]);
  timeline.listQuantityUpdates.mockResolvedValue([{ orderItemId: 'legacy', metadata: { previousQuantity: 2 } }]);
  const result = await service.findItemsForMarketplaceConfirmation(['untouched', 'saved', 'unknown', 'legacy']);
  expect(result.map((item) => item.marketplaceQuantity)).toEqual([1, 1, null, 2]);
  expect(result.map((item) => item.quantity)).toEqual([1, 3, 4, 5]);
  expect(timeline.listQuantityUpdates).toHaveBeenCalledWith(['legacy'], { session: undefined });
});

test('invalid earliest evidence never falls through to a later internal quantity', async () => {
  timeline.listQuantityUpdates.mockResolvedValue([
    { orderItemId: 'legacy', metadata: {} },
    { orderItemId: 'legacy', metadata: { previousQuantity: 3 } },
  ]);
  const session = {};
  expect(await service.resolveMarketplaceQuantities([{ _id: 'legacy', quantity: 4, quantityOverride: 4 }], { session }))
    .toEqual([expect.objectContaining({ marketplaceQuantity: null })]);
  expect(timeline.listQuantityUpdates).toHaveBeenCalledWith(['legacy'], { session });
});
