const listingContentProfile = Object.freeze({
  code: 'AMAZON_US_APPAREL_CONTENT_V1',
  version: 1,
  marketplaceCode: 'AMAZON_US',
  language: 'en-US',
  limits: Object.freeze({
    titleCodePoints: 200,
    bulletCount: 5,
    bulletCodePoints: 500,
    searchTerms: Object.freeze({ min: 1, max: 50, maxUtf8Bytes: 249 }),
    recommendedColors: Object.freeze({ min: 1, max: 3, reasonCodePoints: 300 }),
  }),
});

module.exports = { listingContentProfile };
