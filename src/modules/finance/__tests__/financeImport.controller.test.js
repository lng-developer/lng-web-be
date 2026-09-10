jest.mock('../services/financeImport.service', () => ({
  hasCompletedSettlementImport: jest.fn(),
}));

const service = require('../services/financeImport.service');
const controller = require('../controllers/financeImport.controller');

describe('completed settlement import controller', () => {
  test('returns only the completed flag for a valid reference', async () => {
    const req = {
      params: { referenceId: '27554249931' },
      auth: { tokenType: 'EXTENSION', scopes: [{ scopeType: 'shop', scopeId: '507f1f77bcf86cd799439011' }] },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    service.hasCompletedSettlementImport.mockResolvedValue({ completed: true });

    await controller.hasCompletedSettlementImport(req, res);

    expect(service.hasCompletedSettlementImport).toHaveBeenCalledWith('27554249931', req.auth);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { completed: true } });
  });
});
