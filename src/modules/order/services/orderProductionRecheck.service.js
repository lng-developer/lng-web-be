const logger = require('../../../shared/utils/logger');
const orderItemRepository = require('../repositories/orderItem.repository');

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

async function recheckProductionForOrder(orderId, authContext = {}, source = 'ORDER_UNBLOCKED') {
  const productionPublic = require('../../production/public');
  const items = await orderItemRepository.listAllByOrder(orderId);
  const result = { checked: items.length, rechecked: 0, failed: 0 };

  for (const item of items) {
    const orderItemId = toId(item);
    try {
      await productionPublic.createOrRecheckTaskForOrderItem(orderItemId, {
        ...(authContext || {}),
        system: true,
        source,
      });
      result.rechecked += 1;
    } catch (error) {
      result.failed += 1;
      logger.warn('Production recheck after order unblock skipped', { orderId, orderItemId, source, error });
    }
  }

  return result;
}

module.exports = {
  recheckProductionForOrder,
};
