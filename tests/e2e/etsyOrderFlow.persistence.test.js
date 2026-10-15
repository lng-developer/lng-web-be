// Real domain services and repositories; only external address/queue transport is replaced.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/shared/clients/smartyClient', () => ({
  validateUsStreetAddress: jest.fn().mockResolvedValue([{
    delivery_line_1: '1 Test St', last_line: 'Test City NY 10001',
    components: { primary_number: '1', street_name: 'Test', street_suffix: 'St', city_name: 'Test City', state_abbreviation: 'NY', zipcode: '10001' },
    analysis: { dpv_match_code: 'Y', dpv_footnotes: 'AABB', enhanced_match: 'postal-match' },
  }]),
}));
jest.mock('../../src/config/queue', () => ({
  createQueue: (queueName) => ({ add: async (name, payload) => { mockJobs.push({ queueName, name, payload }); return { id: String(mockJobs.length) }; } }),
}));
jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => { throw new Error('Real Redis is forbidden in Etsy flow tests'); },
}));

const mockJobs = [];
require('../../src/config').redis.enabled = true;
const mongoose = require('mongoose');
const fixture = require('./helpers/etsyFlowFixture');
const importer = require('../../src/modules/integration/externalOrderImport/sources/manualExcel/manualExcelImport.service');
const customization = require('../../src/modules/customization/public');
const mapping = require('../../src/modules/mapping/public');
const catalog = require('../../src/modules/catalog/public');
const catalogService = require('../../src/modules/catalog/services/listing.service');
const design = require('../../src/modules/design/services/designTask.service');
const orderPort = require('../../src/modules/order/public');
const production = require('../../src/modules/production/public');
const Shop = require('../../src/modules/shop/models/shop.model');
const Order = require('../../src/modules/order/models/order.model');
const Item = require('../../src/modules/order/models/orderItem.model');
const Listing = require('../../src/modules/catalog/models/listing.model');
const Issue = require('../../src/modules/integration/externalOrderImport/models/externalOrderImportIssue.model');
const DesignTask = require('../../src/modules/design/models/designTask.model');
const Media = require('../../src/modules/media/models/mediaAsset.model');
const Account = require('../../src/modules/auth/models/account.model');
const Employee = require('../../src/modules/hr/models/employeeProfile.model');
const Variant = require('../../src/modules/catalog/models/listingVariant.model');
const Group = require('../../src/modules/catalog/models/productTypeGroup.model');
const Template = require('../../src/modules/catalog/models/internalTemplate.model');
const Projection = require('../../src/modules/order/models/orderWorkbenchProjection.model');
const Vendor = require('../../src/modules/vendor/models/vendor.model');
const VendorProduct = require('../../src/modules/vendor/models/vendorProduct.model');
const CostCenter = require('../../src/modules/vendor/models/vendorCostCenter.model');
const ProductionTask = require('../../src/modules/production/models/productionTask.model');
const Submission = require('../../src/modules/vendorSubmission/models/vendorSubmission.model');
const vendorSubmission = require('../../src/modules/vendorSubmission/services/vendorSubmission.service');

jest.setTimeout(90000);
const auth = { system: true, permissions: ['CATALOG:READ', 'CATALOG:WRITE', 'DESIGN:READ', 'DESIGN:WRITE', 'DESIGN:WORK', 'DESIGN:REVIEW', 'MAPPING:READ', 'MAPPING:WRITE', 'PRODUCTION:READ', 'PRODUCTION:WRITE', 'VENDOR_SUBMISSIONS:WRITE'] };
let shop;
let fetchSpy;
let requestSpies;

beforeAll(fixture.startDatabase);
afterAll(fixture.stopDatabase);
beforeEach(async () => {
  jest.clearAllMocks();
  mockJobs.length = 0;
  await fixture.clearDatabase();
  shop = await Shop.create({ name: 'Synthetic Etsy Shop' });
  const deny = () => { throw new Error('Unexpected outbound network request in Etsy flow test'); };
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(deny);
  requestSpies = ['http', 'https'].flatMap((protocol) => ['request', 'get'].map((method) => jest.spyOn(require(protocol), method).mockImplementation(deny)));
});
afterEach(() => {
  try {
    if (fetchSpy) expect(fetchSpy).not.toHaveBeenCalled();
    requestSpies?.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  } finally {
    fetchSpy?.mockRestore();
    requestSpies?.forEach((spy) => spy.mockRestore());
  }
});

async function importRows(rows = [fixture.etsyRow()]) {
  const result = await importer.importEtsySoldOrderItems({
    buffer: fixture.csvBuffer(rows), originalFilename: 'synthetic-etsy.csv', mimeType: 'text/csv',
    shopId: String(shop._id), marketplaceCode: 'ETSY_US',
  });
  const issues = await Issue.find({ importJobId: result.jobId }).lean();
  expect(issues.map((issue) => ({ code: issue.errorCode, message: issue.errorMessage }))).toEqual([]);
  expect(result).toMatchObject({ importedCount: rows.length, failedCount: 0 });
  for (const { payload } of mockJobs.filter((job) => job.queueName === 'external-order-customization-assets' && job.payload.importJobId === result.jobId)) {
    await require('../../src/modules/integration/externalOrderImport/services/customizationAssetProcessor.service').processCustomizationAssets(payload);
  }
  for (const { payload } of mockJobs.filter((job) => job.queueName === 'external-order-post-import' && job.payload.importJobId === result.jobId)) {
    const processed = await require('../../src/modules/integration/externalOrderImport/services/postImportMappingProcessor.service').processPostImportMapping(payload);
    expect(processed.skipped).toBe(false);
  }
  return result;
}

test('CSV import persists identity and personalization; repeated import keeps one order and listing', async () => {
  await importRows();
  const order = await Order.findOne({ externalOrderId: '9000000001' }).lean();
  const item = await Item.findOne({ orderId: order._id }).lean();
  expect(String(order.shopId)).toBe(String(shop._id));
  expect(order).toMatchObject({ salesChannelCode: 'ETSY', paymentStatus: 'PAID', externalStatus: 'New' });
  expect(item).toMatchObject({ externalItemId: '9000000002', sku: 'TEST-ORNAMENT', quantity: 1 });
  const parsed = await customization.parseForOrderItem(String(item._id));
  expect(parsed.parsedData.amazonCustomization.customerInputs.texts).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'Alex/Test' })]));
  const projection = await Projection.findOne({ orderId: order._id }).lean();
  expect(projection.items[0].customization.customerInputs.texts).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'Alex/Test' })]));
  const listing = await Listing.findOne({ etsyListingId: '9000000003' }).lean();
  expect(listing).toMatchObject({ qcStatus: 'APPROVED', sku: 'TEST-ORNAMENT' });
  await importRows();
  expect(await Order.countDocuments()).toBe(1);
  expect(await Item.countDocuments()).toBe(1);
  expect(await Listing.countDocuments()).toBe(1);
  expect(String((await Item.findOne().lean())._id)).toBe(String(item._id));
  expect(JSON.stringify((await customization.getByOrderItem(String(item._id))).parsedData)).toContain('Alex/Test');
});

test('duplicate SKU with different Etsy IDs links separate listings; manual listings stay draft', async () => {
  await importRows([fixture.etsyRow(), fixture.etsyRow({ 'Order ID': '9000000011', 'Transaction ID': '9000000012', 'Listing ID': '9000000013' })]);
  const items = await Item.find().sort({ externalItemId: 1 }).lean();
  expect(items).toHaveLength(2);
  expect(String(items[0].listingId)).not.toBe(String(items[1].listingId));
  expect((await Listing.findById(items[0].listingId).lean()).etsyListingId).toBe('9000000003');
  expect((await Listing.findById(items[1].listingId).lean()).etsyListingId).toBe('9000000013');
  const manual = await catalogService.createListing({ shopId: String(shop._id), salesChannelCode: 'ETSY', marketplaceCode: 'ETSY_US', sku: 'MANUAL', etsyListingId: '9000000099', title: 'Manual draft' }, auth);
  expect(manual.qcStatus).toBe('DRAFT');
});

async function approvePsd(taskId) {
  const account = await Account.create({ email: 'designer@example.test', passwordHash: 'test-only', passwordSalt: 'test-only', status: require('../../src/modules/auth/constants/auth.constants').accountStatuses.ACTIVE });
  await Employee.create({ accountId: account._id, employeeCode: 'TESTDESIGNER', fullName: 'Synthetic Designer', status: 'ACTIVE' });
  const actor = { accountId: String(account._id), permissions: [], scopes: [{ scopeType: 'shop', scopeId: String(shop._id), permissions: auth.permissions }] };
  expect((await design.assignTask(taskId, { assignedDesignerId: actor.accountId }, actor)).status).toBe('ASSIGNED');
  expect((await design.startTask(taskId, {}, actor)).status).toBe('IN_PROGRESS');
  const asset = await Media.create({ originalFilename: 'synthetic.psd', storageFilename: 'synthetic.psd', relativeStoragePath: 'test/synthetic.psd', size: 16, mimeType: 'image/vnd.adobe.photoshop', assetPurpose: 'PSD_TEMPLATE', uploadStatus: 'READY' });
  expect((await design.submitTask(taskId, { submittedAssetIds: [String(asset._id)] }, actor)).status).toBe('SUBMITTED');
  const reviewer = await Account.create({ email: 'reviewer@example.test', passwordHash: 'test-only', passwordSalt: 'test-only', status: require('../../src/modules/auth/constants/auth.constants').accountStatuses.ACTIVE });
  const reviewActor = { ...actor, accountId: String(reviewer._id) };
  expect((await design.approveTask(taskId, { approvedAssetId: String(asset._id) }, reviewActor)).status).toBe('APPROVED');
  const persisted = await DesignTask.findById(taskId).lean();
  expect(persisted.submissions).toHaveLength(1);
  expect(persisted.submissions[0].status).toBe('APPROVED');
  return asset;
}

test('listing PSD request is idempotent, late main image reaches task, QC approval survives reimport', async () => {
  await importRows();
  const listing = await Listing.findOne().lean();
  const { task, created } = await catalogService.requestListingPsd(String(listing._id), {}, auth);
  const repeated = await catalogService.requestListingPsd(String(listing._id), {}, auth);
  expect(created).toBe(true);
  expect(repeated.created).toBe(false);
  expect(repeated.task.id).toBe(task.id);
  expect(await DesignTask.countDocuments()).toBe(1);
  const imageUrl = 'https://i.etsystatic.com/123/synthetic.jpg';
  await catalog.fillEtsyListingImage({ shopId: String(shop._id), marketplaceCode: 'ETSY_US', etsyListingId: '9000000003', productImageUrl: imageUrl });
  expect((await design.getTask(task.id, auth)).listing.productImageUrl).toBe(imageUrl);
  const asset = await approvePsd(task.id);
  await importRows();
  const refreshed = await Listing.findById(listing._id).lean();
  expect(String(refreshed.defaultPsdTemplateAssetId)).toBe(String(asset._id));
  expect(refreshed.productImageUrl).toBe(imageUrl);
  expect(await DesignTask.countDocuments()).toBe(1);
});

test('approving a variant PSD does not make a sibling variant ready', async () => {
  await importRows();
  const listing = await Listing.findOne().lean();
  const groups = await Group.create([{ code: 'ONE', name: 'One' }, { code: 'TWO', name: 'Two' }]);
  const variants = [];
  for (const group of groups) {
    const template = await Template.create({ code: `T_${group.code}`, name: group.name, productTypeGroupId: group._id, requiresPsd: true });
    variants.push(await Variant.create({ listingId: listing._id, productTypeGroupId: group._id, internalTemplateId: template._id }));
  }
  const task = await design.createPsdTemplateTaskFromListingVariant(String(listing._id), String(variants[0]._id), {}, auth);
  const asset = await approvePsd(task.id);
  expect(String((await Variant.findById(variants[0]._id).lean()).psdTemplateAssetId)).toBe(String(asset._id));
  expect((await Variant.findById(variants[1]._id).lean()).psdTemplateAssetId).toBeNull();
  expect((await catalog.getListingVariantById(String(variants[1]._id))).psdReadiness.status).toBe('MISSING');
  expect((await Listing.findById(listing._id).lean()).defaultPsdTemplateAssetId).toBeNull();
});

test('cancelled reimport persists refund and blocks production, including after stale New data', async () => {
  await importRows();
  await importRows([fixture.etsyRow({ 'LNG Etsy Status': 'CANCELLED', 'LNG Payment Status': 'REFUNDED' })]);
  const item = await Item.findOne().lean();
  expect(item.status).toBe('CANCELLED');
  expect((await Order.findOne().lean()).paymentStatus).toBe('REFUNDED');
  await expect(production.createOrRecheckTaskForOrderItem(String(item._id), auth)).rejects.toThrow(/cancel|review/i);
  await importRows();
  expect((await Item.findById(item._id).lean()).status).toBe('CANCELLED');
  await expect(orderPort.assertMarketplaceAllowsFulfillment(String(item.orderId), String(item._id))).rejects.toThrow(/cancel|review/i);
  await expect(production.createOrRecheckTaskForOrderItem(String(item._id), auth)).rejects.toThrow(/cancel|review/i);
});

test('configured mapping produces a production task with customization; cancellation with work requires review', async () => {
  const row = fixture.etsyRow({ SKU: 'J9999-ORNAMENT-151026-001' });
  await importRows([row]);
  const item = await Item.findOne().lean();
  const listing = await Listing.findOne().lean();
  await expect(production.createOrRecheckTaskForOrderItem(String(item._id), auth)).rejects.toThrow(/plan|ready/i);
  const group = await Group.create({ code: 'ORNAMENT', name: 'Ornament' });
  const template = await Template.create({ code: 'ORNAMENT_TEST', name: 'Ornament test', productTypeGroupId: group._id, requiresPsd: true,
    artworkSlots: [{ key: 'FRONT', label: 'Front', type: 'TEXT', required: true }] });
  const variant = await Variant.create({ listingId: listing._id, productTypeGroupId: group._id, internalTemplateId: template._id });
  await require('../../src/modules/mapping/models/mappingSkuConfigRule.model').create({ shopId: shop._id, salesChannelCode: 'ETSY', marketplaceCode: 'ETSY_US', configCode: 'ORNAMENT', productTypeGroupId: group._id, internalTemplateId: template._id });
  const task = await design.createPsdTemplateTaskFromListingVariant(String(listing._id), String(variant._id), {}, auth);
  const vendor = await Vendor.create({ code: 'TEST_VENDOR', name: 'No network vendor', fulfillmentType: 'POD' });
  const product = await VendorProduct.create({ vendorId: vendor._id, productTypeGroupId: group._id, code: 'ORNAMENT', name: 'Test ornament' });
  const cost = await CostCenter.create({ vendorId: vendor._id, vendorProductId: product._id, code: 'TEST_COST', name: 'Test cost', baseCostAmount: 500, currency: 'USD' });
  const plan = await mapping.selectFulfillmentPlan(String(item._id), { vendorProductId: String(product._id), vendorCostCenterId: String(cost._id) }, auth);
  expect(plan.status).toBe('READY');
  await orderPort.markFulfillmentReady(String(item._id), { system: true, permissions: ['ORDERS:WRITE'] });
  await production.createOrRecheckTaskForOrderItem(String(item._id), auth);
  const blockedTask = await ProductionTask.findOne({ orderItemId: item._id }).lean();
  expect(blockedTask.status).toBe('BLOCKED');
  expect(blockedTask.blockers).toContain('PSD_MISSING');
  await approvePsd(task.id);
  await production.createOrRecheckTaskForOrderItem(String(item._id), auth);
  const productionTask = await ProductionTask.findOne({ orderItemId: item._id }).lean();
  expect(productionTask).not.toBeNull();
  expect(productionTask.blockers).not.toContain('PSD_MISSING');
  expect(String(productionTask._id)).toBe(String(blockedTask._id));
  expect(String(productionTask.listingVariantId)).toBe(String(variant._id));
  expect(productionTask.customizationSnapshot.customerInputs.texts).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'Alex/Test' })]));
  expect(await Submission.countDocuments()).toBe(0);

  const cancelled = await importer.importEtsySoldOrderItems({ buffer: fixture.csvBuffer([{ ...row, 'LNG Etsy Status': 'CANCELLED', 'LNG Payment Status': 'REFUNDED' }]), originalFilename: 'cancel.csv', mimeType: 'text/csv', shopId: String(shop._id), marketplaceCode: 'ETSY_US' });
  expect(cancelled.failedCount).toBe(1);
  expect((await Item.findById(item._id).lean()).status).not.toBe('CANCELLED');
  const issues = await Issue.find({ importJobId: cancelled.jobId }).lean();
  expect(issues.some((issue) => /manual review/i.test(issue.errorMessage))).toBe(true);
  await expect(production.markSentToVendor(String(productionTask._id), String(new mongoose.Types.ObjectId()), auth)).rejects.toThrow(/cancel|review/i);
  // Seed a retryable submission to exercise the real last-mile guard without calling any vendor.
  const submission = await Submission.create({ productionTaskId: productionTask._id, orderId: item.orderId, orderItemId: item._id, shopId: shop._id, status: 'DRAFT' });
  await expect(vendorSubmission.submitToVendor(String(submission._id), {}, auth)).rejects.toThrow(/cancel|review/i);
  expect((await Submission.findById(submission._id).lean()).status).toBe('DRAFT');
});

test('requesting PSD outside the authorized shop is rejected without creating a task', async () => {
  await importRows();
  const listing = await Listing.findOne().lean();
  const wrongScope = { permissions: [], scopes: [{ scopeType: 'shop', scopeId: String(new mongoose.Types.ObjectId()), permissions: ['CATALOG:WRITE'] }] };
  await expect(catalogService.requestListingPsd(String(listing._id), {}, wrongScope)).rejects.toThrow(/forbidden/i);
  expect(await DesignTask.countDocuments()).toBe(0);
});

test('Amazon import retains its own customization evidence alongside Etsy data', async () => {
  await importRows();
  const result = await importer.importManualExcelOrderReport({
    buffer: fixture.csvBuffer([{
      'order-id': '114-0000000-0000001', 'order-item-id': 'AMAZON-ITEM-1',
      asin: 'B0TESTONLY1', sku: 'TEST-AMAZON', 'product-name': 'Synthetic Amazon item',
      'quantity-purchased': '1', 'item-price': '20', currency: 'USD',
      'ship-country': 'US', 'ship-address-1': '1 Test Street', 'ship-city': 'Test City', 'ship-state': 'NY', 'ship-postal-code': '10001',
      'customized-url': 'https://example.test/synthetic.zip',
      'item-extensions-data': '{"text":"Amazon-only personalization"}',
    }]),
    originalFilename: 'amazon-test.csv', mimeType: 'text/csv', shopId: String(shop._id), marketplaceCode: 'AMAZON_US',
  });
  expect(await Issue.find({ importJobId: result.jobId }).lean()).toEqual([]);
  expect(result.importedCount).toBe(1);
  const item = await Item.findOne({ salesChannelCode: 'AMAZON' }).lean();
  expect(item.asin).toBe('B0TESTONLY1');
  const parsed = await customization.parseForOrderItem(String(item._id));
  expect(parsed.parsedData.amazonCustomization).toMatchObject({ customizedUrl: 'https://example.test/synthetic.zip', itemExtensionsData: '{"text":"Amazon-only personalization"}' });
  expect(parsed.parsedData.etsyCustomization).toBeUndefined();
  const etsyItem = await Item.findOne({ salesChannelCode: 'ETSY' }).lean();
  expect(JSON.stringify((await customization.getByOrderItem(String(etsyItem._id))).parsedData)).toContain('Alex/Test');
  // ZIP download/extraction is covered by the separate Amazon ZIP regression suite, never a live download here.
});
