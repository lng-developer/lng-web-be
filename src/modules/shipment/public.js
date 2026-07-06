const service = require('./services/shipment.service');

const publicPort = {
  getShipmentByOrderItem: service.getShipmentByOrderItem,
  listSummariesByOrderItemIds: service.listSummariesByOrderItemIds,
};

module.exports = publicPort;
