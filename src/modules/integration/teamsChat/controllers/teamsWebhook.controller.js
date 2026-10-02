const httpStatus = require('../../../../shared/constants/httpStatus');
const logger = require('../../../../shared/utils/logger');
const teamsSyncService = require('../services/teamsSync.service');

async function handleWebhook(req, res) {
  const validationToken = req.query.validationToken;
  if (validationToken) {
    logger.info('teams_webhook_handshake_received');
    return res.status(httpStatus.OK).contentType('text/plain').send(validationToken);
  }

  const notifications = req.body?.value;
  if (!Array.isArray(notifications) || !notifications.length) {
    return res.status(httpStatus.ACCEPTED).json({ received: 0 });
  }

  res.status(httpStatus.ACCEPTED).json({ received: notifications.length });

  Promise.allSettled(
    notifications.map((notification) => teamsSyncService.processInboundWebhookNotification(notification)),
  ).then((results) => {
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        logger.warn('teams_webhook_processing_rejected', {
          index: idx,
          error: result.reason?.message,
        });
      }
    });
  });
}

module.exports = {
  handleWebhook,
};
