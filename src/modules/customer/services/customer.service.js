const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const repository = require('../repositories/customer.repository');
const {
  toCustomerDto,
  toCustomerEventDto,
  toCustomerNoteDto,
  toCustomerSummaryDto,
} = require('../dtos/customer.dto');

function notFound() {
  return new AppError('Customer not found', 404, true, errorCodes.RESOURCE_NOT_FOUND);
}

function scopedParams(params = {}, authContext = {}) {
  const permissions = authContext.permissions || [];
  if (['CUSTOMERS:READ', 'CUSTOMERS:WRITE', 'CUSTOMERS:MANAGE'].some((permission) => permissions.includes(permission))) return params;
  const shopIds = (authContext.scopes || [])
    .filter((scope) => String(scope.scopeType).toLowerCase() === 'shop')
    .filter((scope) => (scope.permissions || []).some((permission) => ['CUSTOMERS:READ', 'CUSTOMERS:WRITE', 'CUSTOMERS:MANAGE'].includes(permission)))
    .map((scope) => String(scope.scopeId))
    .filter(Boolean);
  return { ...params, shopIds };
}

async function listCustomers(params) {
  const result = await repository.listCustomers(params);
  return { ...result, items: result.items.map(toCustomerDto) };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

async function exportCustomersCsv(params) {
  const result = await listCustomers({ ...params, page: 1, limit: params.limit || 5000 });
  return csvRows([
    [
      'Customer ID', 'Name', 'Email', 'Phone', 'Lifecycle', 'Care status', 'Orders',
      'Order items', 'Revenue (minor)', 'AOV (minor)', 'Currency', 'Countries',
      'Shops', 'First order at', 'Last order at', 'Last order age days',
    ],
    ...result.items.map((customer) => [
      customer.id,
      customer.name,
      customer.emailMasked,
      customer.phoneMasked,
      customer.lifecycle,
      customer.careStatus,
      customer.orderCount,
      customer.orderItemCount,
      customer.totalRevenueAmount,
      customer.averageOrderValue,
      customer.currency,
      (customer.countries || []).join('|'),
      (customer.shops || []).map((shop) => shop.name || shop.shopId).filter(Boolean).join('|'),
      customer.firstOrderAt,
      customer.lastOrderAt,
      customer.lastOrderAgeDays,
    ]),
  ]);
}

async function getSummary(params, authContext) {
  return toCustomerSummaryDto(await repository.summarize(scopedParams(params, authContext)));
}

async function getCustomerById(customerId) {
  const customer = await repository.findById(customerId);
  if (!customer) throw notFound();
  const [events, notes] = await Promise.all([
    repository.listEvents(customerId, { page: 1, limit: 10 }),
    repository.listNotes(customerId, { limit: 10 }),
  ]);
  return {
    ...toCustomerDto(customer),
    latestEvents: events.items.map(toCustomerEventDto),
    latestNotes: notes.map(toCustomerNoteDto),
  };
}

async function listTimeline(customerId, params) {
  const customer = await repository.findById(customerId);
  if (!customer) throw notFound();
  const [events, notes] = await Promise.all([
    repository.listEvents(customerId, params),
    repository.listNotes(customerId, { limit: params.limit }),
  ]);
  return {
    events: events.items.map(toCustomerEventDto),
    notes: notes.map(toCustomerNoteDto),
  };
}

async function addNote(customerId, payload, authContext = {}) {
  const customer = await repository.findById(customerId);
  if (!customer) throw notFound();
  const note = await repository.createNote({
    customerId,
    body: payload.body,
    type: payload.type || 'GENERAL',
    createdBy: authContext.accountId || null,
  });
  const saved = await repository.saveCustomer({
    ...customer,
    careStatus: payload.careStatus || customer.careStatus,
    lastCareNoteAt: new Date(),
  });
  await repository.createEvent({
    customerId,
    eventType: 'NOTE_ADDED',
    sourceModule: 'customer',
    sourceId: String(note._id),
    message: payload.body,
    occurredAt: note.createdAt,
    metadata: { type: note.type },
  });
  return { customer: toCustomerDto(saved), note: toCustomerNoteDto(note) };
}

async function updateCareStatus(customerId, payload, authContext = {}) {
  const customer = await repository.findById(customerId);
  if (!customer) throw notFound();
  const saved = await repository.saveCustomer({
    ...customer,
    careStatus: payload.careStatus,
    lastCareNoteAt: payload.note ? new Date() : customer.lastCareNoteAt,
  });
  if (payload.note) {
    await addNote(customerId, { body: payload.note, type: 'CARE' }, authContext);
  } else {
    await repository.createEvent({
      customerId,
      eventType: 'CARE_STATUS_CHANGED',
      sourceModule: 'customer',
      sourceId: customerId,
      message: `Care status changed to ${payload.careStatus}`,
      occurredAt: new Date(),
      metadata: { careStatus: payload.careStatus },
    });
  }
  return toCustomerDto(saved);
}

module.exports = {
  addNote,
  exportCustomersCsv,
  getCustomerById,
  getSummary,
  listCustomers,
  listTimeline,
  updateCareStatus,
};
