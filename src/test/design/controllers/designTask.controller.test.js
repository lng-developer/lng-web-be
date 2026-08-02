jest.mock('../../../modules/design/services/designTask.service');
jest.mock('../../../modules/design/services/designSubmissionScore.service');
jest.mock('../../../modules/media/public', () => ({ storeUploadedFile: jest.fn() }));

const mediaPublic = require('../../../modules/media/public');
const controller = require('../../../modules/design/controllers/designTask.controller');

test('uploadAsset returns the canonical media Location for the created asset', async () => {
  mediaPublic.storeUploadedFile.mockResolvedValue({
    _id: '660000000000000000000901',
    originalFilename: 'design.psd',
    mimeType: 'application/octet-stream',
    size: 8,
  });
  const req = { auth: { accountId: 'account-1' }, file: { originalname: 'design.psd' } };
  const res = {
    json: jest.fn(),
    location: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };

  await controller.uploadAsset(req, res);

  expect(res.location).toHaveBeenCalledWith('/api/media/assets/660000000000000000000901');
  expect(res.status).toHaveBeenCalledWith(201);
});
