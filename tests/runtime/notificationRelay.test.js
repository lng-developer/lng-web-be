const { EventEmitter } = require('node:events');

jest.mock('../../src/modules/notification/public', () => ({
  events: new (require('node:events').EventEmitter)(),
}));
jest.mock('../../src/shared/utils/logger', () => ({ warn: jest.fn() }));

const { events } = require('../../src/modules/notification/public');
const { connectNotificationRelay } = require('../../src/runtime/notificationRelay');

const notification = { id: 'notification-1', recipientAccountId: 'account-1' };
const channel = 'lng-web:9:notification.created';

test('background notifications publish while connected and stop on close', async () => {
  const redis = { status: 'ready', publish: jest.fn().mockResolvedValue(1) };
  const close = await connectNotificationRelay({ role: 'scheduler', redis, db: 9 });
  events.emit('notification.created', notification);
  expect(redis.publish).toHaveBeenCalledWith(channel, JSON.stringify(notification));
  redis.status = 'reconnecting';
  events.emit('notification.created', notification);
  close();
  redis.status = 'ready';
  events.emit('notification.created', notification);
  expect(redis.publish).toHaveBeenCalledTimes(1);
});

test('API republishes only notifications on its Redis channel into local events', async () => {
  const subscriber = new EventEmitter();
  subscriber.subscribe = jest.fn().mockResolvedValue(1);
  subscriber.disconnect = jest.fn();
  const listener = jest.fn();
  events.on('notification.created', listener);
  const redis = { duplicate: () => subscriber };
  const close = await connectNotificationRelay({ role: 'api', redis, db: 9 });
  expect(subscriber.subscribe).toHaveBeenCalledWith(channel);
  subscriber.emit('message', 'lng-web:10:notification.created', JSON.stringify(notification));
  subscriber.emit('message', channel, 'invalid JSON');
  subscriber.emit('message', channel, JSON.stringify({ id: 'missing-recipient' }));
  subscriber.emit('message', channel, JSON.stringify(notification));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith(notification);
  expect(subscriber.disconnect).not.toHaveBeenCalled();
  close();
  expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
  events.off('notification.created', listener);
});
