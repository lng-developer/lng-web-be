const express = require('express');
const asyncHandler = require('../../../middlewares/asyncHandler');
const authPublic = require('../../auth/public');
const controller = require('../controllers/customer.controller');

const router = express.Router();
const requireRead = authPublic.authorizeAnyPermission('CUSTOMERS:READ', 'CUSTOMERS:WRITE', 'CUSTOMERS:MANAGE');
const requireWrite = authPublic.authorizeAnyPermission('CUSTOMERS:WRITE', 'CUSTOMERS:MANAGE');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'customer', status: 'ok' });
});

router.get('/', authPublic.authenticate, requireRead, asyncHandler(controller.listCustomers));
router.get('/summary', authPublic.authenticate, requireRead, asyncHandler(controller.getSummary));
router.get('/:customerId', authPublic.authenticate, requireRead, asyncHandler(controller.getCustomer));
router.get('/:customerId/timeline', authPublic.authenticate, requireRead, asyncHandler(controller.listTimeline));
router.post('/:customerId/notes', authPublic.authenticate, requireWrite, asyncHandler(controller.addNote));
router.patch('/:customerId/care-status', authPublic.authenticate, requireWrite, asyncHandler(controller.updateCareStatus));

module.exports = router;
