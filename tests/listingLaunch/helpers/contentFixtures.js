const mongoose = require('mongoose');

const ids = {
  shopId: '660000000000000000000001',
  accountId: '660000000000000000000002',
  productTypeGroupId: '660000000000000000000003',
  internalTemplateId: '660000000000000000000004',
};
const inputs = {
  profileCode: 'AMAZON_US_APPAREL_CONTENT_V1', keyword: 'Cat accountant', language: 'en-US',
  productFacts: { brand: 'LNG', productName: 'Cat shirt', material: 'Cotton', features: ['Crew neck'] },
  availableColors: [{ code: 'BLACK', label: 'Black' }], factsConfirmed: true,
  confirmedBy: ids.accountId, confirmedAt: new Date('2026-09-15T00:00:00Z'),
};
const snapshot = {
  profileCode: inputs.profileCode, profileVersion: 1, marketplaceCode: 'AMAZON_US', brief: 'Cat shirt',
  productTypeGroupId: ids.productTypeGroupId, internalTemplateId: ids.internalTemplateId,
  keyword: inputs.keyword, language: inputs.language,
  productFacts: { ...inputs.productFacts, personalization: null, careInstructions: null },
  availableColors: inputs.availableColors,
  catalog: { productTypeGroup: { code: 'TEE', name: 'T-shirt', printMethod: 'DTG' }, internalTemplate: { code: 'FRONT', name: 'Front' } },
};
const content = {
  title: 'Cat accountant cotton shirt', bullets: ['Cotton', 'Crew neck', 'Cat design', 'Accountant theme', 'LNG brand'],
  searchTerms: ['cat accountant'], recommendedColors: [{ code: 'BLACK', reason: 'Neutral base' }],
};
function launchPayload(overrides = {}) {
  return { ...ids, salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US', state: 'PRODUCT_SELECTED',
    brief: 'Cat shirt', contentInputs: inputs, contentInputVersion: 1, ...overrides };
}
function runPayload(launchId, overrides = {}) {
  return { launchId, shopId: ids.shopId, requestKey: '11111111-1111-4111-8111-111111111111',
    requestHash: 'a'.repeat(64), inputVersion: 1, inputHash: 'b'.repeat(64), inputSnapshot: snapshot,
    profileVersion: 1, promptVersion: 1, provider: 'OPENAI', model: 'test-model', requestedBy: ids.accountId,
    resultVersionId: new mongoose.Types.ObjectId(), ...overrides };
}
module.exports = { ids, inputs, snapshot, content, launchPayload, runPayload };
