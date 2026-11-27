const crypto = require('crypto');
jest.mock('../../../order/public', () => ({ findItemsForMarketplaceConfirmation: jest.fn(), findItemsByIds: jest.fn() }));
jest.mock('../../../shipment/public');
jest.mock('../../../auth/public');
jest.mock('../repositories/amazonTrackingSubmission.repository');
jest.mock('../../extensionCommand/repositories/extensionCommand.repository');
const service = require('../services/amazonTrackingSubmission.service');
const order = require('../../../order/public');
const shipment = require('../../../shipment/public');
const authPort = require('../../../auth/public');
const repository = require('../repositories/amazonTrackingSubmission.repository');
const commands = require('../../extensionCommand/repositories/extensionCommand.repository');

const shopId = '507f1f77bcf86cd799439011';
const itemIds = ['507f1f77bcf86cd799439012', '507f1f77bcf86cd799439013'];
const shipmentIds = ['507f1f77bcf86cd799439014', '507f1f77bcf86cd799439015'];
const auth = { permissions: ['ORDERS:WRITE', 'ORDERS:READ'] };
let items;
let shipments;
beforeEach(() => {
  jest.resetAllMocks();
  authPort.canAccessScope.mockReturnValue(true);
  items = itemIds.map((_id, index) => ({ _id, externalItemId: `17576883483024${index}`, quantity: 2, quantityOverride: 2, marketplaceQuantity: 1 }));
  shipments = shipmentIds.map((_id, index) => ({ _id, shopId, orderItemId: itemIds[index], externalOrderId: '111-5476345-6321833', status: 'SHIPPED', carrier: 'USPS', trackingNumber: `TRACK${index}`, shippedAt: new Date('2026-11-26'), marketplaceConfirmationStatus: 'PENDING' }));
  order.findItemsByIds.mockImplementation(async () => items);
  order.findItemsForMarketplaceConfirmation.mockImplementation(async () => items);
  shipment.findByIds.mockImplementation(async () => shipments);
  repository.create.mockImplementation(async (data) => ({ _id: 'draft', ...data }));
});

test('manual TSV exports one Amazon pack while internal quantities are two', async () => {
  await service.createManualDraft({ shopId, shipmentIds }, auth);
  const saved = repository.create.mock.calls[0][0];
  expect(saved.rows.map(row => row.quantity)).toEqual([1, 1]);
  expect(saved.tsv.trim().split('\r\n').slice(1).map(line => line.split('\t')[2])).toEqual(['1', '1']);
  expect(items.map(item => item.quantity)).toEqual([2, 2]);
});

test('automatic item-level tracking preview uses the marketplace quantities', async () => {
  const result = await service.previewSubmission({ shopId, shipmentIds }, auth);
  expect(result.items.map(item => item.quantity)).toEqual(['1', '1']);
  expect(result.tsv.trim().split('\r\n').slice(1).map(line => line.split('\t')[2])).toEqual(['1', '1']);
});

test('automatic submission persists original quantities in both rows and the uploaded file', async () => {
  commands.findAgentById.mockResolvedValue({ _id: 'agent', shopId });
  commands.createCommand.mockResolvedValue({ _id: 'command' });
  repository.updateById.mockResolvedValue({ _id: 'draft' });
  await service.createSubmission({ shopId, shipmentIds, agentId: 'agent' }, auth);
  const saved = repository.create.mock.calls[0][0];
  expect(saved.rows.map(row => row.quantity)).toEqual([1, 1]);
  expect(saved.tsv.trim().split('\r\n').slice(1).map(line => line.split('\t')[2])).toEqual(['1', '1']);
});

test('preview does not group an unresolved item into an order-wide confirmation', async () => {
  items[0].marketplaceQuantity = null;
  shipments[1].trackingNumber = shipments[0].trackingNumber;
  const result = await service.previewSubmission({ shopId, shipmentIds }, auth);
  expect(result.tsv.trim().split('\r\n')[1].split('\t').slice(1, 3)).toEqual([items[1].externalItemId, '1']);
  expect(result.items.some(row => row.issues.includes('missing_marketplace_quantity'))).toBe(true);
});

test('preserves order-level blank quantity for a common tracking number', async () => {
  shipments[1].trackingNumber = shipments[0].trackingNumber;
  const result = await service.previewSubmission({ shopId, shipmentIds }, auth);
  expect(result.tsv.trim().split('\r\n')[1].split('\t').slice(1, 3)).toEqual(['', '']);
});

test('blocks draft and automatic dispatch when an overridden item has no original evidence', async () => {
  items[0].marketplaceQuantity = null;
  await expect(service.createManualDraft({ shopId, shipmentIds }, auth)).rejects.toThrow(/marketplace quantity/i);
  commands.findAgentById.mockResolvedValue({ _id: 'agent', shopId });
  await expect(service.createSubmission({ shopId, shipmentIds, agentId: 'agent' }, auth)).rejects.toThrow(/marketplace quantity/i);
  expect(repository.create).not.toHaveBeenCalled();
  expect(commands.createCommand).not.toHaveBeenCalled();
});

function oldDraft(quantity = 2) {
  return { _id: '507f1f77bcf86cd799439016', shopId, status: 'DRAFT', rows: [{ shipmentId: shipmentIds[0], orderItemId: itemIds[0], externalOrderId: shipments[0].externalOrderId, externalItemId: items[0].externalItemId }],
    tsv: `order-id\torder-item-id\tquantity\r\n${shipments[0].externalOrderId}\t${items[0].externalItemId}\t${quantity}\r\n` };
}

test('rejects downloading a stale draft containing the internal quantity', async () => {
  repository.findById.mockResolvedValue(oldDraft());
  await expect(service.getSubmission('draft', auth)).rejects.toThrow(/recreate/i);
});

test('allows an existing draft with the correct marketplace quantity', async () => {
  repository.findById.mockResolvedValue(oldDraft(1));
  await expect(service.getSubmission('draft', auth)).resolves.toMatchObject({ id: '507f1f77bcf86cd799439016' });
});

test('validates persisted drafts through shipment linkage when row schema omits orderItemId', async () => {
  const Model = require('../models/amazonTrackingSubmission.model');
  const persisted = new Model(oldDraft(1)).toObject();
  expect(persisted.rows[0].orderItemId).toBeUndefined();
  repository.findById.mockResolvedValue(persisted);
  await expect(service.getSubmission('draft', auth)).resolves.toMatchObject({ tsv: persisted.tsv });
  expect(shipment.findByIds).toHaveBeenCalledWith([shipmentIds[0]]);
});

test('blocks a queued stale payload before the extension receives its TSV', async () => {
  commands.findAgentForToken.mockResolvedValue({ _id: 'agent' });
  commands.findCommandById.mockResolvedValue({ _id: 'command', agentId: 'agent', leaseTokenHash: crypto.createHash('sha256').update('lease').digest('hex') });
  repository.findByCommandId.mockResolvedValue(oldDraft());
  await expect(service.getLeasedPayload('command', { clientId: 'client', leaseToken: 'lease' }, { tokenType: 'EXTENSION', extensionTokenId: 'token' })).rejects.toThrow(/recreate/i);
});
