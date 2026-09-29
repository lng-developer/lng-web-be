const Submission = require('../models/amazonTrackingSubmission.model');
function create(payload) { return Submission.create(payload).then((row) => row.toObject()); }
function findByCommandId(commandId) { return Submission.findOne({ commandId }).select('+tsv').lean(); }
function findById(id) { return Submission.findById(id).select('+tsv').lean(); }
function findNonTerminalByShipmentIds(shipmentIds) { return Submission.findOne({ shipmentIds: { $in: shipmentIds }, status: { $in: ['QUEUED', 'SUBMITTED', 'WAITING_AMAZON'] } }).lean(); }
function updateById(id, patch) { return Submission.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after', runValidators: true }).lean(); }
module.exports = { create, findByCommandId, findById, findNonTerminalByShipmentIds, updateById };
