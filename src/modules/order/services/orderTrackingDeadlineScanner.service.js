const orderRepository = require('../repositories/order.repository');
const notificationPublic = require('../../notification/public');
const organizationPublic = require('../../organization/public');
const logger = require('../../../shared/utils/logger');
const { withDistributedLock } = require('../../../shared/utils/distributedLock');

let timer = null;
let running = false;
const SCANNER_LOCK_KEY = 'scheduler:order_tracking_deadline';
const SCANNER_LOCK_TTL_MS = 120000;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Scans candidate orders approaching or past tracking deadline and dispatches notifications
 */
async function scanOrderTrackingDeadlines({ now = new Date() } = {}) {
  const baseTime = new Date(now);
  const nowTime = baseTime.getTime();
  const ms24h = 24 * 60 * 60 * 1000;
  const ms48h = 48 * 60 * 60 * 1000;
  const cutoffDate = new Date(nowTime + ms48h);

  const candidates = await orderRepository.findTrackingDeadlineCandidates({ cutoffDate });

  let scanned = 0;
  let due48h = 0;
  let due24h = 0;
  let overdue = 0;
  let notified = 0;

  for (const order of candidates) {
    scanned++;

    const items = order.orderItems || [];
    if (items.length > 0 && items.every((item) => item.fulfillmentStatus === 'FULFILLED' || item.status === 'SHIPPED')) {
      continue;
    }

    const shipByTime = new Date(order.shipByDate).getTime();
    let type;
    let title;
    let includeLeaders = false;

    if (shipByTime <= nowTime) {
      type = 'ORDER_TRACKING_OVERDUE';
      title = `Order tracking overdue: ${order.externalOrderId || order._id}`;
      includeLeaders = true;
      overdue++;
    } else if (shipByTime <= nowTime + ms24h) {
      type = 'ORDER_TRACKING_DUE_24H';
      title = `Order tracking due in 24h: ${order.externalOrderId || order._id}`;
      includeLeaders = true;
      due24h++;
    } else if (shipByTime <= nowTime + ms48h) {
      type = 'ORDER_TRACKING_DUE_48H';
      title = `Order tracking due in 48h: ${order.externalOrderId || order._id}`;
      includeLeaders = false;
      due48h++;
    } else {
      continue;
    }

    const formattedDate = new Date(order.shipByDate).toISOString().slice(0, 10);
    const message = `Order ${order.externalOrderId || order._id} has shipByDate on ${formattedDate} but is missing tracking.`;

    const staffIds = (order.assignedStaffIds || []).map(String).filter(Boolean);
    let recipients = staffIds;

    if (includeLeaders && staffIds.length > 0) {
      try {
        const leaderIds = await organizationPublic.listLeadersForAccountIds(staffIds);
        recipients = [...new Set([...staffIds, ...(leaderIds || [])])];
      } catch (error) {
        logger.warn('order_tracking_deadline_leader_lookup_failed', {
          orderId: order._id,
          error: error.message,
        });
      }
    }

    const dayKey = baseTime.toISOString().slice(0, 10);
    for (const recipientAccountId of recipients) {
      const deduplicationKey = `${type}:${order._id}:${recipientAccountId}:${dayKey}`;
      try {
        await notificationPublic.notify({
          recipientAccountId,
          type,
          title,
          message,
          relatedResource: { type: 'order', id: String(order._id) },
          deduplicationKey,
        });
        notified++;
      } catch (error) {
        logger.warn('order_tracking_deadline_notify_failed', {
          recipientAccountId,
          orderId: order._id,
          error: error.message,
        });
      }
    }
  }

  return { scanned, due48h, due24h, overdue, notified };
}

async function runOnce() {
  if (running) return null;
  return withDistributedLock(SCANNER_LOCK_KEY, SCANNER_LOCK_TTL_MS, async () => {
    if (running) return null;
    running = true;
    try {
      const result = await scanOrderTrackingDeadlines();
      logger.info('order_tracking_deadline_scan_completed', result);
      return result;
    } catch (error) {
      logger.warn('order_tracking_deadline_scan_failed', { error });
      return null;
    } finally {
      running = false;
    }
  });
}

function startOrderTrackingDeadlineScheduler(intervalMs = DEFAULT_INTERVAL_MS) {
  if (timer) return timer;
  timer = setInterval(() => {
    runOnce().catch((error) => logger.warn('order_tracking_deadline_scheduler_error', { error }));
  }, intervalMs);
  timer.unref?.();
  logger.info('order_tracking_deadline_scheduler_started', { intervalMs });
  return timer;
}

function stopOrderTrackingDeadlineScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('order_tracking_deadline_scheduler_stopped');
  }
}

module.exports = {
  scanOrderTrackingDeadlines,
  runOnce,
  startOrderTrackingDeadlineScheduler,
  stopOrderTrackingDeadlineScheduler,
};
