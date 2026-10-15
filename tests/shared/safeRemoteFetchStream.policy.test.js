const { EventEmitter } = require('events');
const dns = require('dns').promises;
const https = require('https');
const { safeRemoteFetchStream } = require('../../src/shared/network/safeRemoteFetchStream');

afterEach(() => jest.restoreAllMocks());
test('caller URL policy runs before DNS or network access', async () => {
  const lookup = jest.spyOn(dns, 'lookup');
  await expect(safeRemoteFetchStream('https://evil.test/x', { validateUrl: () => { throw new Error('blocked'); } })).rejects.toThrow('blocked');
  expect(lookup).not.toHaveBeenCalled();
});
test('redirect cannot escape caller allowlist and blocked response is closed', async () => {
  jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  const response = { statusCode: 302, headers: { location: 'https://evil.test/image.jpg' }, destroy: jest.fn() };
  const request = jest.spyOn(https, 'request').mockImplementation((url, options, callback) => {
    const req = new EventEmitter();
    req.setTimeout = jest.fn();
    req.end = () => callback(response);
    return req;
  });
  await expect(safeRemoteFetchStream('https://i.etsystatic.com/a.jpg', { validateUrl: (value) => {
    if (new URL(value).hostname !== 'i.etsystatic.com') throw new Error('blocked');
  } })).rejects.toThrow('blocked');
  expect(request).toHaveBeenCalledTimes(1);
  expect(response.destroy).toHaveBeenCalled();
});
