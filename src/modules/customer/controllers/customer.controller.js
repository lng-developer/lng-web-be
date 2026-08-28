const service = require('../services/customer.service');
const {
  assertValid,
  careStatusSchema,
  exportCustomersSchema,
  listCustomersSchema,
  noteSchema,
  timelineSchema,
} = require('../validators/customer.validator');

async function listCustomers(req, res) {
  const query = assertValid(listCustomersSchema, req.query);
  res.status(200).json({ success: true, data: await service.listCustomers(query) });
}

async function exportCustomersCsv(req, res) {
  const query = assertValid(exportCustomersSchema, req.query);
  const csv = await service.exportCustomersCsv(query);
  res
    .status(200)
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', 'attachment; filename="customers.csv"')
    .send(csv);
}

async function getSummary(req, res) {
  const query = assertValid(listCustomersSchema, req.query);
  res.status(200).json({ success: true, data: await service.getSummary(query, req.auth) });
}

async function getCustomer(req, res) {
  res.status(200).json({ success: true, data: await service.getCustomerById(req.params.customerId) });
}

async function listTimeline(req, res) {
  const query = assertValid(timelineSchema, req.query);
  res.status(200).json({
    success: true,
    data: await service.listTimeline(req.params.customerId, query),
  });
}

async function addNote(req, res) {
  const payload = assertValid(noteSchema, req.body);
  res.status(201).json({
    success: true,
    data: await service.addNote(req.params.customerId, payload, req.auth),
  });
}

async function updateCareStatus(req, res) {
  const payload = assertValid(careStatusSchema, req.body);
  res.status(200).json({
    success: true,
    data: await service.updateCareStatus(req.params.customerId, payload, req.auth),
  });
}

module.exports = {
  addNote,
  exportCustomersCsv,
  getCustomer,
  getSummary,
  listCustomers,
  listTimeline,
  updateCareStatus,
};
