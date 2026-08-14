const projection = require('./services/customerProjection.service');
const customerService = require('./services/customer.service');

module.exports = {
  upsertFromOrderSnapshot: projection.upsertFromOrderSnapshot,
  getCustomerById: customerService.getCustomerById,
  listCustomerOptions: customerService.listCustomers,
};
