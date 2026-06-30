const ExternalOrderImportSourceFile = require('../models/externalOrderImportSourceFile.model');

async function create(payload) {
  const document = await ExternalOrderImportSourceFile.create(payload);
  return document.toObject();
}

async function findById(sourceFileId) {
  return ExternalOrderImportSourceFile.findById(sourceFileId).lean();
}

async function findByHash(source, fileHash) {
  return ExternalOrderImportSourceFile.findOne({ source, fileHash }).lean();
}

async function linkToJob(sourceFileId, importJobId) {
  return ExternalOrderImportSourceFile.findByIdAndUpdate(
    sourceFileId,
    { $set: { importJobId } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  create,
  findById,
  findByHash,
  linkToJob,
};
