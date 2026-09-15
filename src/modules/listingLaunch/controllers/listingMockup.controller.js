const service = require('../services/listingMockup.service');
const { uploadSchema } = require('../validators/listingMockup.validator');
const { assertValid } = require('./requestValidation');
async function uploadMockup(req, res) {
  try {
    const command = assertValid(uploadSchema, req.body);
    const data = await service.uploadMockup(req.params.id, req.file, command, req.auth);
    res.status(201).json({ success: true, data });
  } finally { if (req.file) req.file.buffer = null; }
}
module.exports = { uploadMockup };
