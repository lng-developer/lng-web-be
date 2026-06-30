const salesChannelCodes = Object.freeze({
  AMAZON: 'AMAZON',
  ETSY: 'ETSY',
  SHOPIFY: 'SHOPIFY',
  TIKTOK_SHOP: 'TIKTOK_SHOP',
  WALMART: 'WALMART',
  CUSTOM: 'CUSTOM',
});

const externalOrderSources = Object.freeze({
  AMAZON_EXTENSION_REPORT: 'AMAZON_EXTENSION_REPORT',
  MANUAL_EXCEL: 'MANUAL_EXCEL',
});

module.exports = {
  salesChannelCodes,
  externalOrderSources,
};
