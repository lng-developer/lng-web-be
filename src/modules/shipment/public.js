const service = require('./services/shipment.service');

const publicPort = {
  getShipmentByOrderItem: service.getShipmentByOrderItem,
  listSummariesByOrderItemIds: service.listSummariesByOrderItemIds,
  summarizeShippedByOrderItemIds: service.summarizeShippedByOrderItemIds,
  summarizeShipments: service.summarizeShipments,
};

module.exports = publicPort;
