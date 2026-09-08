const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('../../src/modules/order/public', () => ({
  findById: jest.fn(),
  findItemById: jest.fn(),
  listItemsByOrder: jest.fn(),
}));
jest.mock('../../src/modules/mapping/public', () => ({
  getFulfillmentPlanForOrderItem: jest.fn(),
}));
jest.mock('../../src/modules/shipment/public', () => ({
  getShipmentByOrderItem: jest.fn(),
}));
jest.mock('../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));
jest.mock('../../src/modules/hr/public', () => ({
  getEmployeeProfileByEmployeeCode: jest.fn(),
}));
jest.mock('../../src/modules/organization/public', () => ({
  listAccountOrganizationSummaries: jest.fn(),
}));
jest.mock('../../src/modules/finance/repositories/financeImport.repository', () => ({
  sumFeesByOrderItem: jest.fn(),
  sumRefundsByOrderItem: jest.fn(),
}));

const AuditEvent = require('../../src/modules/audit/models/auditEvent.model');
const FinanceSnapshot = require('../../src/modules/finance/models/financeSnapshot.model');
const auditPublic = require('../../src/modules/audit/public');
const orderPublic = require('../../src/modules/order/public');
const mappingPublic = require('../../src/modules/mapping/public');
const shipmentPublic = require('../../src/modules/shipment/public');
const authPublic = require('../../src/modules/auth/public');
const hrPublic = require('../../src/modules/hr/public');
const financeImportRepository = require('../../src/modules/finance/repositories/financeImport.repository');
const service = require('../../src/modules/finance/services/financeSnapshot.service');

let database;
jest.setTimeout(120000);

describe('finance snapshot audit transaction', () => {
  beforeAll(async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri('lng_web_be_finance_audit_test'));
    await Promise.all([FinanceSnapshot.init(), AuditEvent.init()]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await database.stop();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([FinanceSnapshot.deleteMany({}), AuditEvent.deleteMany({})]);
  });

  test('rolls back the snapshot when its audit write fails', async () => {
    const orderId = new mongoose.Types.ObjectId();
    const orderItemId = new mongoose.Types.ObjectId();
    const shopId = new mongoose.Types.ObjectId();
    orderPublic.findItemById.mockResolvedValue({
      _id: orderItemId,
      orderId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: 'SKU-1',
      price: { itemPriceAmount: 5000, currency: 'USD' },
    });
    mappingPublic.getFulfillmentPlanForOrderItem.mockResolvedValue({
      id: new mongoose.Types.ObjectId(),
      costEstimate: { totalAmount: 2000, lines: [{ code: 'BASE_COST', amount: 2000 }] },
    });
    shipmentPublic.getShipmentByOrderItem.mockResolvedValue(null);
    authPublic.canAccessScope.mockReturnValue(true);
    hrPublic.getEmployeeProfileByEmployeeCode.mockResolvedValue(null);
    financeImportRepository.sumFeesByOrderItem.mockResolvedValue(null);
    financeImportRepository.sumRefundsByOrderItem.mockResolvedValue(null);
    jest.spyOn(auditPublic, 'record').mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.recalculateOrderItem(String(orderItemId), {
      permissions: ['FINANCE:WRITE'],
    })).rejects.toThrow('audit unavailable');

    await expect(FinanceSnapshot.countDocuments({ orderItemId })).resolves.toBe(0);
    await expect(AuditEvent.countDocuments({})).resolves.toBe(0);
  });

  test('rolls back the first order snapshot when the second item fails', async () => {
    const orderId = new mongoose.Types.ObjectId();
    const firstItemId = new mongoose.Types.ObjectId();
    const secondItemId = new mongoose.Types.ObjectId();
    const shopId = new mongoose.Types.ObjectId();
    const items = [firstItemId, secondItemId].map((_id) => ({
      _id,
      orderId,
      shopId,
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      sku: `SKU-${_id}`,
      price: { itemPriceAmount: 5000, currency: 'USD' },
    }));
    orderPublic.listItemsByOrder.mockResolvedValue(items);
    orderPublic.findItemById.mockImplementation(async (id) => (
      items.find((item) => String(item._id) === String(id))
    ));
    mappingPublic.getFulfillmentPlanForOrderItem
      .mockResolvedValueOnce({
        id: new mongoose.Types.ObjectId(),
        costEstimate: { totalAmount: 2000, lines: [{ code: 'BASE_COST', amount: 2000 }] },
      })
      .mockRejectedValueOnce(new Error('second item failed'));
    shipmentPublic.getShipmentByOrderItem.mockResolvedValue(null);
    authPublic.canAccessScope.mockReturnValue(true);
    hrPublic.getEmployeeProfileByEmployeeCode.mockResolvedValue(null);
    financeImportRepository.sumFeesByOrderItem.mockResolvedValue(null);
    financeImportRepository.sumRefundsByOrderItem.mockResolvedValue(null);
    const auditSpy = jest.spyOn(auditPublic, 'record');

    await expect(service.recalculateOrder(String(orderId), {
      permissions: ['FINANCE:WRITE'],
    })).rejects.toThrow('second item failed');

    await expect(FinanceSnapshot.countDocuments({ orderId })).resolves.toBe(0);
    await expect(AuditEvent.countDocuments({})).resolves.toBe(0);
    expect(auditSpy).not.toHaveBeenCalled();
  });
});
