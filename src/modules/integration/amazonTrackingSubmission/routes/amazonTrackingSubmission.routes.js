const express = require('express');
const asyncHandler = require('../../../../middlewares/asyncHandler');
const authPublic = require('../../../auth/public');
const controller = require('../controllers/amazonTrackingSubmission.controller');

const router = express.Router();
const write = authPublic.authorizeAnyPermission('ORDERS:WRITE', 'SHIPMENTS:WRITE');
const read = authPublic.authorizeAnyPermission('ORDERS:READ', 'ORDERS:WRITE', 'SHIPMENTS:READ', 'SHIPMENTS:WRITE');

router.post('/', authPublic.authenticate, write, asyncHandler(controller.createSubmission));
router.get('/', authPublic.authenticate, read, asyncHandler(controller.listSubmissions));
router.get('/:submissionId', authPublic.authenticate, read, asyncHandler(controller.getSubmission));

module.exports = router;
