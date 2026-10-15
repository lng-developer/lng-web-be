const TeamsOAuthState = require('../models/teamsOAuthState.model');

async function create(data) { return TeamsOAuthState.create(data).then((row) => row.toObject()); }

async function consume(stateHash, now = new Date()) {
  return TeamsOAuthState.findOneAndDelete({ stateHash, expiresAt: { $gt: now } })
    .select('+encryptedVerifier').lean();
}

module.exports = { create, consume };
