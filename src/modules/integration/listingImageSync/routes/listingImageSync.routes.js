const express = require('express');
const multer = require('multer');
const auth = require('../../../auth/public');
const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const asyncHandler = require('../../../../middlewares/asyncHandler');
const controller = require('../controllers/listingImageSync.controller');
const router = express.Router();
const read = auth.authorizeAnyPermission('CATALOG:READ', 'CATALOG:WRITE');
const write = auth.authorizeAnyPermission('CATALOG:WRITE');
const extensionOnly = (req, res, next) => req.auth?.tokenType === 'EXTENSION' ? next() : next(new AppError('Forbidden', 403, true, errorCodes.AUTHORIZATION_ERROR));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 6, fieldSize: 2200, parts: 7 } }).single('file');
function receiveImage(req, res, next) {
  upload(req, res, (error) => next(error ? new AppError('Invalid or oversized image upload', 400, true, errorCodes.VALIDATION_ERROR) : undefined));
}
router.get('/schedules', auth.authenticate, read, asyncHandler(controller.listSchedules));
router.put('/schedules/:agentId', auth.authenticate, write, asyncHandler(controller.upsertSchedule));
router.get('/jobs', auth.authenticate, read, asyncHandler(controller.listJobs));
router.post('/jobs', auth.authenticate, write, asyncHandler(controller.createJob));
router.post('/jobs/:jobId/pause', auth.authenticate, write, asyncHandler(controller.pause));
router.post('/jobs/:jobId/resume', auth.authenticate, write, asyncHandler(controller.resume));
router.post('/jobs/:jobId/retry', auth.authenticate, write, asyncHandler(controller.retry));
router.post('/agent/commands/:commandId/items/query', auth.authenticate, extensionOnly, asyncHandler(controller.getCommandItems));
router.post('/agent/commands/:commandId/items/:itemId/result', auth.authenticate, extensionOnly, receiveImage, asyncHandler(controller.recordResult));
router.post('/agent/commands/:commandId/pause', auth.authenticate, extensionOnly, asyncHandler(controller.pauseCommand));
module.exports = router;
