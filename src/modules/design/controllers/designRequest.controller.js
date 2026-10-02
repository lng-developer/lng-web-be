const httpStatus = require('../../../shared/constants/httpStatus');
const service = require('../services/designRequest.service');
const { assertValid } = require('./requestValidation');
const {
  designRequestAssignmentSchema,
  designRequestStatusSchema,
  designRequestIdSchema,
} = require('../validators/designRequest.validator');

async function list(req, res) {
  const data = await service.listDesignRequests(req.auth);
  res.status(httpStatus.OK).json({ success: true, data });
}

async function assign(req, res) {
  const { id } = assertValid(designRequestIdSchema, req.params);
  const body = assertValid(designRequestAssignmentSchema, req.body);
  const data = await service.assignDesignRequest(id, body.assignedDesignerAccountId, req.auth);
  res.status(httpStatus.OK).json({ success: true, data });
}

async function updateStatus(req, res) {
  const { id } = assertValid(designRequestIdSchema, req.params);
  const body = assertValid(designRequestStatusSchema, req.body);
  const data = await service.updateDesignRequestStatus(id, body.status, req.auth);
  res.status(httpStatus.OK).json({ success: true, data });
}

module.exports = { list, assign, updateStatus };
