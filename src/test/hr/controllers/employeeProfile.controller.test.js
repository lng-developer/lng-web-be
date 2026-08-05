jest.mock('fs', () => ({ createReadStream: jest.fn(() => 'avatar-stream') }));
jest.mock('stream/promises', () => ({ pipeline: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../modules/hr/services/employeeProfile.service', () => ({
  getProfile: jest.fn(),
  uploadProfileAvatar: jest.fn(),
  withProfileAvatar: jest.fn(),
  withMyProfileAvatar: jest.fn(),
}));

const fs = require('fs');
const { pipeline } = require('stream/promises');
const service = require('../../../modules/hr/services/employeeProfile.service');
const controller = require('../../../modules/hr/controllers/employeeProfile.controller');

function response() {
  return {
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
}

test('uploads an avatar through the HR service', async () => {
  const file = { buffer: Buffer.from('image'), originalname: 'avatar.png', mimetype: 'image/png' };
  const req = { auth: { accountId: 'account-1' }, file, params: { profileId: 'profile-1' } };
  const res = response();
  service.uploadProfileAvatar.mockResolvedValue({ id: 'profile-1', avatarAssetId: 'asset-1' });

  await controller.uploadProfileAvatar(req, res);

  expect(service.uploadProfileAvatar).toHaveBeenCalledWith('profile-1', file, req.auth);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: { id: 'profile-1', avatarAssetId: 'asset-1' },
  });
});

test('streams avatar bytes from Media without exposing storage paths', async () => {
  const req = { auth: { permissions: ['HR_EMPLOYEES:READ'] }, params: { profileId: 'profile-1' } };
  const res = response();
  service.withProfileAvatar.mockImplementation((_profileId, _auth, reader) => reader({
    mediaAsset: { mimeType: 'image/png', size: 5 },
    localPath: 'private/avatar.png',
  }));

  await controller.getProfileAvatar(req, res);

  expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
  expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 5);
  expect(fs.createReadStream).toHaveBeenCalledWith('private/avatar.png');
  expect(pipeline).toHaveBeenCalledWith('avatar-stream', res);
});

test('streams the authenticated employee own avatar', async () => {
  const req = { auth: { accountId: 'account-1' } };
  const res = response();
  service.withMyProfileAvatar.mockImplementation((_auth, reader) => reader({
    mediaAsset: { mimeType: 'image/png', size: 5 },
    localPath: 'private/avatar.png',
  }));

  await controller.getMyProfileAvatar(req, res);

  expect(service.withMyProfileAvatar).toHaveBeenCalledWith(req.auth, expect.any(Function));
  expect(fs.createReadStream).toHaveBeenCalledWith('private/avatar.png');
});
