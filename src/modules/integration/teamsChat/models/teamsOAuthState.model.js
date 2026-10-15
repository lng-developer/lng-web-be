const mongoose = require('mongoose');

const teamsOAuthStateSchema = new mongoose.Schema({
  stateHash: { type: String, required: true, unique: true, index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
  encryptedVerifier: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

module.exports = mongoose.model('TeamsOAuthState', teamsOAuthStateSchema);
