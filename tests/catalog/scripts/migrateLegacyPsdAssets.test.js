jest.mock('mongoose', () => ({
  connection: { name: 'lng_web_be_test' },
  createConnection: jest.fn(),
}));

jest.mock('../../../src/modules/catalog/models/listing.model', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../../src/modules/media/public', () => ({
  findAssetsByProviderAssetIds: jest.fn(),
  registerExternalAsset: jest.fn(),
}));

const mongoose = require('mongoose');
const Listing = require('../../../src/modules/catalog/models/listing.model');
const mediaPublic = require('../../../src/modules/media/public');
const {
  buildDesignKey,
  migrateLegacyPsdAssets,
  normalizeLegacyPsd,
} = require('../../../src/modules/catalog/scripts/migrateLegacyPsdAssets');

function chainLean(value) {
  return { select: () => ({ lean: async () => value }) };
}

function collectionRows(rows) {
  return {
    find: () => ({
      project: () => ({
        limit: () => ({
          toArray: async () => rows,
        }),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mediaPublic.findAssetsByProviderAssetIds.mockResolvedValue([]);
});

test('normalizes legacy Amazon PSD metadata into the current Wasabi key', () => {
  expect(buildDesignKey('b0test123', '.zip')).toBe('psd/B0TEST123/B0TEST123.zip');
  expect(normalizeLegacyPsd({
    _id: 'legacy-1',
    asin: 'b0test123',
    psd: { status: 'Available', file_name: 'design.zip', file_ext: '.zip', mime: 'application/zip', size: 123 },
  }, 'AMAZON')).toMatchObject({
    source: 'AMAZON',
    match: { asin: 'B0TEST123' },
    key: 'psd/B0TEST123/B0TEST123.zip',
    originalFilename: 'design.zip',
    mimeType: 'application/zip',
    size: 123,
  });
});

test('dry-run reports matched PSD assets without writing', async () => {
  mongoose.createConnection.mockReturnValue({
    asPromise: async () => ({
      name: 'lng_db',
      collection: () => collectionRows([{
        _id: 'legacy-1',
        asin: 'B0TEST123',
        psd: { status: 'Available', file_name: 'design.zip', file_ext: '.zip', mime: 'application/zip', size: 123 },
      }]),
      close: jest.fn(),
    }),
  });
  Listing.find.mockReturnValue(chainLean([{ _id: 'listing-1', shopId: 'shop-1', asin: 'B0TEST123', defaultPsdTemplateAssetId: null }]));

  await expect(migrateLegacyPsdAssets({
    dryRun: true,
    legacyUri: 'mongodb://legacy',
    source: 'amazon',
  })).resolves.toMatchObject({
    dryRun: true,
    oldDatabase: 'lng_db',
    newDatabase: 'lng_web_be_test',
    scanned: 1,
    eligible: 1,
    wouldCreateMedia: 1,
    wouldLink: 1,
  });
  expect(mediaPublic.registerExternalAsset).not.toHaveBeenCalled();
  expect(Listing.updateOne).not.toHaveBeenCalled();
});
