const { isDuplicateKeyError } = require('../../../shared/utils/mongo');
const shopPublic = require('../../shop/public');
const { orderTimelineEventTypes } = require('../constants/orderTimelineEventTypes');
const { orderTimelineSources } = require('../constants/orderTimelineSources');
const orderRepository = require('../repositories/order.repository');
const orderItemRepository = require('../repositories/orderItem.repository');
const orderTimelineService = require('./orderTimeline.service');
const {
  buildExternalIdentity,
  compactObject,
  conflictError,
  getCustomizationResult,
  getEntityId,
  getImportSources,
  hasCustomization,
  normalizeTrimmed,
  validateDto,
} = require('./orderImport.helpers');
const {
  buildItemCreatePayload,
  buildItemUpdatePayload,
  buildOrderCreatePayload,
  buildOrderUpdatePayload,
} = require('./orderImport.payloads');

async function appendImportTimeline({ order, orderItem, shopId, identity, created, externalItemId, rawRecordId }) {
  const eventType = orderItem
    ? (created
      ? orderTimelineEventTypes.ORDER_ITEM_IMPORTED
      : orderTimelineEventTypes.ORDER_ITEM_REIMPORTED)
    : (created
      ? orderTimelineEventTypes.ORDER_IMPORTED
      : orderTimelineEventTypes.ORDER_REIMPORTED);

  await orderTimelineService.appendTimeline(compactObject({
    orderId: getEntityId(order),
    orderItemId: orderItem ? getEntityId(orderItem) : undefined,
    shopId,
    salesChannelCode: identity.salesChannelCode,
    marketplaceCode: identity.marketplaceCode,
    eventType,
    source: orderTimelineSources.IMPORT,
    metadata: orderItem
      ? { externalItemId, rawRecordId }
      : { externalOrderId: identity.externalOrderId },
  }));
}

async function upsertOrder(dto, identity, now) {
  const existingOrder = await orderRepository.findByExternalIdentity(identity);

  if (!existingOrder) {
    try {
      const order = await orderRepository.create(buildOrderCreatePayload(dto, identity, now));
      return { order, created: true, updated: false };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      const recoveredOrder = await orderRepository.findByExternalIdentity(identity);

      if (!recoveredOrder) {
        throw conflictError('Duplicate order detected but existing order could not be loaded', {
          identity,
        });
      }

      const order = await orderRepository.updateFromExternalImport(
        getEntityId(recoveredOrder),
        buildOrderUpdatePayload(dto, now),
      );

      return { order, created: false, updated: true };
    }
  }

  const order = await orderRepository.updateFromExternalImport(
    getEntityId(existingOrder),
    buildOrderUpdatePayload(dto, now),
  );

  return { order, created: false, updated: true };
}

async function upsertItem({ item, dto, identity, orderId, importSources, now }) {
  const externalItemId = normalizeTrimmed(item.externalItemId);
  const existingItem = await orderItemRepository.findByExternalIdentity({ orderId, externalItemId });

  if (!existingItem) {
    try {
      const orderItem = await orderItemRepository.create(
        buildItemCreatePayload(item, dto, identity, orderId, importSources, now),
      );

      return { orderItem, created: true, updated: false };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      const recoveredItem = await orderItemRepository.findByExternalIdentity({ orderId, externalItemId });

      if (!recoveredItem) {
        throw conflictError('Duplicate order item detected but existing item could not be loaded', {
          orderId,
          externalItemId,
        });
      }

      const orderItem = await orderItemRepository.updateFromExternalImport(
        getEntityId(recoveredItem),
        buildItemUpdatePayload(item, dto, now, importSources),
      );

      return { orderItem, created: false, updated: true };
    }
  }

  const orderItem = await orderItemRepository.updateFromExternalImport(
    getEntityId(existingItem),
    buildItemUpdatePayload(item, dto, now, importSources),
  );

  return { orderItem, created: false, updated: true };
}

async function importExternalOrder(externalOrderDto = {}) {
  validateDto(externalOrderDto);
  const importSources = getImportSources(externalOrderDto);
  await shopPublic.assertShopIsActive(externalOrderDto.shopId);

  const now = new Date();
  const identity = buildExternalIdentity(externalOrderDto);
  const { order, created, updated } = await upsertOrder(externalOrderDto, identity, now);
  const orderId = getEntityId(order);

  await appendImportTimeline({
    order,
    shopId: externalOrderDto.shopId,
    identity,
    created,
  });

  const itemResults = [];

  for (const item of externalOrderDto.items) {
    const result = await upsertItem({
      item,
      dto: externalOrderDto,
      identity,
      orderId,
      importSources,
      now,
    });

    await appendImportTimeline({
      order,
      orderItem: result.orderItem,
      shopId: externalOrderDto.shopId,
      identity,
      created: result.created,
      externalItemId: normalizeTrimmed(item.externalItemId),
      rawRecordId: item.rawRecordId,
    });

    itemResults.push({
      orderItemId: getEntityId(result.orderItem),
      externalItemId: normalizeTrimmed(item.externalItemId),
      rawRecordId: item.rawRecordId,
      created: result.created,
      updated: result.updated,
      hasCustomization: hasCustomization(item),
      customization: getCustomizationResult(item),
    });
  }

  return {
    orderId,
    externalOrderId: identity.externalOrderId,
    created,
    updated,
    itemResults,
    warnings: [],
  };
}

module.exports = {
  importExternalOrder,
};
