const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function start(backgroundJobsEnabled, outboundEnabled) {
  const started = [];
  const services = new Proxy({}, {
    get: (_, name) => () => { started.push(name); },
  });
  const context = { module: { exports: {} }, require: name => {
    if (name === '../config') return { backgroundJobsEnabled, outboundEnabled, redis: { enabled: true }, mapping: {}, finance: {} };
    if (name === '../modules/integration/public') return { teamsChat: services, sqlAttendance: services };
    return services;
  }};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/runtime/schedulers.js'), 'utf8'), context);
  await context.module.exports.startSchedulers(() => {});
  return started;
}

test('disabled background starts no scheduler', async () => {
  expect(await start(false, true)).toEqual([]);
});

test('blocked outbound starts only internal schedulers', async () => {
  const started = await start(true, false);
  expect(started).toEqual(expect.arrayContaining(['startMongoIndexUsageSnapshotScheduler', 'startMonthlyLeaveAccrualScheduler']));
  for (const name of ['startVendorTrackingRecheckScheduler', 'startVendorSubmissionRecoveryScheduler',
    'startExtensionOrderScheduleScheduler', 'startAmazonAdsEmailImportScheduler',
    'startTeamsSubscriptionScheduler', 'startTeamsOutboundOutboxScheduler', 'startSqlAttendanceScheduler']) {
    expect(started).not.toContain(name);
  }
});

test('live mode retains external schedulers', async () => {
  expect(await start(true, true)).toEqual(expect.arrayContaining([
    'startVendorTrackingRecheckScheduler', 'startExtensionOrderScheduleScheduler', 'startTeamsSubscriptionScheduler',
  ]));
});
