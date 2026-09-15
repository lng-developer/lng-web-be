const service = require('../services/listingMockup.service');
const { uploadSchema, analysisSchema } = require('../validators/listingMockup.validator');
const analysis = require('../services/listingMockupAnalysis.service');
const { generationParamsSchema } = require('../validators/listingLaunch.validator');
const { assertValid } = require('./requestValidation');
async function uploadMockup(req, res) {
  try {
    const command = assertValid(uploadSchema, req.body);
    const data = await service.uploadMockup(req.params.id, req.file, command, req.auth);
    res.status(201).json({ success: true, data });
  } finally { if (req.file) req.file.buffer = null; }
}
async function requestAnalysis(req, res) {
  const command = assertValid(analysisSchema, req.body);
  const { run, replayed, dispatchWarning } = await analysis.requestAnalysis(req.params.id, command, req.auth);
  res.status(replayed ? 200 : 202).json({ success: true, data: run, replayed, ...(dispatchWarning ? { dispatchWarning } : {}) });
}
async function getAnalysis(req, res) {
  const { id, runId } = assertValid(generationParamsSchema, req.params);
  res.json({ success: true, data: await analysis.getAnalysis(id, runId, req.auth) });
}
module.exports = { uploadMockup, requestAnalysis, getAnalysis };
