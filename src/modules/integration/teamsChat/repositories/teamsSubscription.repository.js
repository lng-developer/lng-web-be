const TeamsSubscription = require('../models/teamsSubscription.model');

async function findActiveSubscription() {
  return TeamsSubscription.findOne({
    status: 'ACTIVE',
    expirationDateTime: { $gt: new Date() },
  }).lean();
}

async function saveSubscription(data) {
  return TeamsSubscription.findOneAndUpdate(
    { subscriptionId: data.subscriptionId },
    { $set: data },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
}

async function updateStatus(subscriptionId, status) {
  return TeamsSubscription.findOneAndUpdate(
    { subscriptionId },
    { $set: { status } },
    { returnDocument: 'after' },
  ).lean();
}

module.exports = {
  findActiveSubscription,
  saveSubscription,
  updateStatus,
};
