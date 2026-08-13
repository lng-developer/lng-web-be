const chatConversationTypes = Object.freeze({
  DIRECT: 'DIRECT',
  TEAM: 'TEAM',
  SHOP: 'SHOP',
  ORDER: 'ORDER',
  ORDER_ITEM: 'ORDER_ITEM',
  PRODUCTION_TASK: 'PRODUCTION_TASK',
  VENDOR_SUBMISSION: 'VENDOR_SUBMISSION',
});

const chatPermissions = Object.freeze({
  READ: 'CHAT:READ',
  WRITE: 'CHAT:WRITE',
});

const chatReadablePermissions = Object.freeze([
  chatPermissions.READ,
  chatPermissions.WRITE,
  'ORDERS:READ',
  'ORDERS:WRITE',
  'PRODUCTION:READ',
  'PRODUCTION:WRITE',
  'DESIGN:WORK',
  'DESIGN:REVIEW',
]);

const chatWritablePermissions = Object.freeze([
  chatPermissions.WRITE,
  'ORDERS:WRITE',
  'PRODUCTION:WRITE',
  'DESIGN:WORK',
]);

module.exports = {
  chatConversationTypes,
  chatPermissions,
  chatReadablePermissions,
  chatWritablePermissions,
};
