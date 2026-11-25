const { execFileSync } = require('child_process');
const path = require('path');
const policyPath = path.resolve(__dirname, '../src/shared/utils/outboundPolicy.js');

function run(source, env = {}) {
  return execFileSync(process.execPath, ['-e', `const policy = require(${JSON.stringify(policyPath)}); ${source}`], {
    encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, APP_ENV: 'development', OUTBOUND_MODE: '', MONGODB_URI: '', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379', ...env },
  }).trim();
}

test('development blocks HTTP, HTTPS, fetch and raw SMTP before network access', () => {
  expect(run(`
    policy.install();
    const assert = require('assert');
    for (const transport of ['http', 'https']) {
      for (const method of ['get', 'request']) {
        assert.throws(() => require(transport)[method]('http://127.0.0.1:1/'), { code: 'OUTBOUND_BLOCKED' });
      }
    }
    Promise.all([
      assert.rejects(fetch('https://example.invalid/'), { code: 'OUTBOUND_BLOCKED' }),
      new Promise(resolve => require('net').connect(25, '127.0.0.1').on('error', error => {
        assert.equal(error.code, 'OUTBOUND_BLOCKED'); resolve();
      }))
    ]).then(() => console.log('blocked'));
  `)).toBe('blocked');
});

test('only configured Mongo and Redis TCP destinations pass the policy', () => {
  expect(run(`
    const assert = require('assert');
    const allow = policy.allowedTcpDestination;
    assert(allow('node1.test.mongodb.net', 27017));
    assert(allow('127.0.0.1', 6379));
    for (const [host, port] of [['node1.prod.mongodb.net',27017],['eviltest.mongodb.net',27017],['node1.test.mongodb.net',443],['127.0.0.1',25]]) assert(!allow(host,port));
    console.log('isolated');
  `, { MONGODB_URI: 'mongodb+srv://cluster.test.mongodb.net/dev' })).toBe('isolated');
});

test('production defaults to live without replacing network transports', () => {
  expect(run(`
    const original = require('https').request;
    policy.install(); policy.assertOutboundAllowed();
    console.log(original === require('https').request);
  `, { APP_ENV: 'production' })).toBe('true');
});

test('development cannot opt into live outbound', () => {
  expect(() => run('policy.install()', { OUTBOUND_MODE: 'live' })).toThrow();
});

test('invalid mode fails closed', () => {
  expect(() => run('policy.install()', { APP_ENV: 'production', OUTBOUND_MODE: 'typo' })).toThrow();
});

test('configured TCP infrastructure still connects while TLS to other ports is blocked', () => {
  expect(run(`
    const net = require('net'), assert = require('assert');
    const server = net.createServer(socket => socket.end('ok'));
    server.listen(0, '127.0.0.1', async () => {
      process.env.REDIS_PORT = String(server.address().port);
      policy.install();
      const received = await new Promise((resolve, reject) => {
        let data = '';
        net.connect({host:'127.0.0.1',port:server.address().port})
          .on('data', chunk => data += chunk).on('end', () => resolve(data)).on('error', reject);
      });
      assert.equal(received, 'ok');
      await new Promise(resolve => require('tls').connect({host:'127.0.0.1',port:25})
        .on('error', error => { assert.equal(error.code, 'OUTBOUND_BLOCKED'); resolve(); }));
      server.close(() => console.log('connected'));
    });
  `)).toBe('connected');
});

test('storage signing and extension claims are blocked before side effects', () => {
  expect(run(`
    const assert = require('assert');
    process.env.APP_ENV = 'test';
    process.env.OUTBOUND_MODE = 'blocked';
    process.env.JWT_ACCESS_SECRET = 'outbound-isolation-test';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
    const storage = require('./src/modules/media/services/wasabiStorage.service');
    assert.throws(() => storage.presignDownload({ key: 'test', filename: 'test' }), {code:'OUTBOUND_BLOCKED'});
    const commands = require('./src/modules/integration/extensionCommand/services/extensionCommand.service');
    Promise.all([
      assert.rejects(commands.claimNext({}, {}), {code:'OUTBOUND_BLOCKED'}),
      assert.rejects(commands.startCommand('test', {}, {}), {code:'OUTBOUND_BLOCKED'}),
      assert.rejects(commands.renewCommand('test', {}, {}), {code:'OUTBOUND_BLOCKED'}),
      assert.rejects(storage.presignUploadPart({key:'test',uploadId:'test',partNumber:1}), {code:'OUTBOUND_BLOCKED'})
    ]).then(() => console.log('blocked'));
  `)).toBe('blocked');
});
