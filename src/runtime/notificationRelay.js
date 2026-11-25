const { events } = require('../modules/notification/public');
const logger = require('../shared/utils/logger');

async function connectNotificationRelay({ role, redis, db }) {
  const event = 'notification.created';
  const channel = `lng-web:${db}:${event}`;
  const logError = (error) => logger.warn('runtime_notification_relay_error', { role, errorCode: error.code });

  if (role === 'api') {
    const subscriber = redis.duplicate();
    subscriber.on('error', logError);
    subscriber.on('message', (topic, payload) => {
      if (topic !== channel) return;
      try {
        const notification = JSON.parse(payload);
        if (typeof notification?.recipientAccountId === 'string') events.emit(event, notification);
      } catch (error) {
        logError(error);
      }
    });
    try {
      await subscriber.subscribe(channel);
    } catch (error) {
      subscriber.disconnect();
      throw error;
    }
    return () => subscriber.disconnect();
  }

  const publish = (notification) => {
    if (redis.status === 'ready') {
      void redis.publish(channel, JSON.stringify(notification)).catch(logError);
    }
  };
  events.on(event, publish);
  return () => events.off(event, publish);
}

module.exports = { connectNotificationRelay };
