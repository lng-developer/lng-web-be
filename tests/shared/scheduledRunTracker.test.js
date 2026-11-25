const { createScheduledRunTracker } = require('../../src/shared/utils/scheduledRunTracker');

test('scheduler drain includes every overlapping run and waits through failures', async () => {
  const tracker = createScheduledRunTracker();
  let finish;
  let fail;
  tracker.track(new Promise((resolve) => { finish = resolve; }));
  tracker.track(new Promise((resolve, reject) => { fail = reject; }));

  const completed = jest.fn();
  const drain = tracker.drain().then(completed);
  const error = new Error('failed run');
  fail(error);
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  finish();
  await drain;
  expect(completed).toHaveBeenCalledWith([
    { status: 'fulfilled', value: undefined },
    { status: 'rejected', reason: error },
  ]);
  await expect(tracker.drain()).resolves.toEqual([]);
});
