const service = require('../services/amazonTrackingSubmission.service');
const repository = require('../repositories/amazonTrackingSubmission.repository');
const shipmentPublic = require('../../../shipment/public');
const orderPublic = require('../../../order/public');
const commands = require('../../extensionCommand/repositories/extensionCommand.repository');
const Model = require('../models/amazonTrackingSubmission.model');
jest.mock('../repositories/amazonTrackingSubmission.repository');
jest.mock('../../../shipment/public');
jest.mock('../../../order/public');
jest.mock('../../extensionCommand/repositories/extensionCommand.repository');

const shopId = '507f1f77bcf86cd799439011';
const shipmentIds = ['507f1f77bcf86cd799439012', '507f1f77bcf86cd799439013'];
const itemIds = ['507f1f77bcf86cd799439014', '507f1f77bcf86cd799439015'];
const auth = { permissions: ['ORDERS:WRITE'] };
const input = { shopId, shipmentIds };
let shipments;
beforeEach(() => {
  jest.resetAllMocks();
  shipments = shipmentIds.map((_id, i) => ({ _id, shopId, orderId: '507f1f77bcf86cd799439016', orderItemId: itemIds[i], externalOrderId: '113-1967256-1428220', status: 'SHIPPED', carrier: 'USPS', trackingNumber: '9214490374008505154599', shippedAt: '2026-11-19T09:45:20Z', marketplaceConfirmationStatus: 'CONFIRMED' }));
  shipmentPublic.findByIds.mockImplementation(async () => shipments);
  shipmentPublic.normalizeTrackingForAmazon.mockImplementation(async s => ({ ...s, carrierCode: 'USPS', shipDate: '2026-11-19', shipMethod: 'USPS Ground Advantage' }));
  orderPublic.findItemsByIds.mockResolvedValue(itemIds.map((_id, i) => ({ _id, externalItemId: `17576883483024${i}`, quantity: i + 1 })));
  repository.create.mockImplementation(async data => ({ _id: '507f1f77bcf86cd799439017', ...data }));
});

describe('manual tracking draft', () => {
  test('stores item-level TSV and snapshots without dispatch or confirmation changes', async () => {
    const draft = await service.createManualDraft(input, auth);
    expect(draft).toMatchObject({ status: 'DRAFT', agentId: null, commandId: null, rowCount: 2 });
    const saved = repository.create.mock.calls[0][0];
    const lines = saved.tsv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1].split('\t').slice(0,3)).toEqual(['113-1967256-1428220', '175768834830240', '1']);
    expect(lines[2].split('\t').slice(0,3)).toEqual(['113-1967256-1428220', '175768834830241', '2']);
    expect(saved.rows).toEqual(expect.arrayContaining([expect.objectContaining({ externalItemId: '175768834830241', quantity: 2, carrierName: '' })]));
    const doc = new Model(saved);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.toObject().rows[1]).toMatchObject({ externalItemId: '175768834830241', quantity: 2, carrier: 'USPS' });
    expect(commands.createCommand).not.toHaveBeenCalled();
    expect(shipmentPublic.updateMarketplaceConfirmation).not.toHaveBeenCalled();
  });
  test('reuses the same draft on repeat creation', async () => {
    repository.findDraftByChecksum.mockResolvedValue({ _id: 'existing', status: 'DRAFT' });
    await expect(service.createManualDraft(input, auth)).resolves.toMatchObject({ id: 'existing', status: 'DRAFT' });
    expect(repository.create).not.toHaveBeenCalled();
  });
  test('denies read-only users and a writer scoped to another shop', async () => {
    for (const context of [{ permissions: ['ORDERS:READ'] }, { scopes: [{ scopeType: 'shop', scopeId: 'another', permissions: ['ORDERS:WRITE'] }] }]) {
      await expect(service.createManualDraft(input, context)).rejects.toThrow('Forbidden');
    }
    expect(shipmentPublic.findByIds).not.toHaveBeenCalled();
  });
  test.each(['CANCELLED','TRACKING_PENDING','DELIVERED'])('rejects %s shipments', async status => {
    shipments[0].status = status;
    await expect(service.createManualDraft(input, auth)).rejects.toThrow('not in SHIPPED status');
    expect(repository.create).not.toHaveBeenCalled();
  });
  test('rejects shipments belonging to a different shop', async () => {
    shipments[0].shopId = 'another';
    await expect(service.createManualDraft(input, auth)).rejects.toThrow('does not belong');
  });
  test('rejects missing requested shipments instead of silently building a partial file', async () => {
    shipments.pop();
    await expect(service.createManualDraft(input, auth)).rejects.toThrow('requested shipments');
  });
  test('requires a valid shop and non-empty unique shipment IDs even for system callers', async () => {
    for (const payload of [{ shipmentIds }, { shopId, shipmentIds: [] }, { shopId, shipmentIds: [shipmentIds[0], shipmentIds[0]] }]) {
      await expect(service.createManualDraft(payload, { system: true })).rejects.toThrow();
    }
    expect(repository.create).not.toHaveBeenCalled();
  });
  test('rejects duplicate item rows and non-Amazon order references', async () => {
    shipments[1].orderItemId = itemIds[0];
    await expect(service.createManualDraft(input, auth)).rejects.toThrow('Duplicate order item');
    shipments[1].orderItemId = itemIds[1]; shipments[0].externalOrderId = '4231429730';
    await expect(service.createManualDraft(input, auth)).rejects.toThrow('Amazon order');
  });
  test('keeps agent required for automatic submissions', () => {
    const doc = new Model({ shopId, status: 'PENDING', filename: 'test.txt', tsv: 'test', rowCount: 1, checksum: 'a' });
    expect(doc.validateSync().errors.agentId).toBeDefined();
  });
});
