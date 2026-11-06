const crypto = require('crypto');
const service = require('../services/amazonTrackingSubmission.service');
const repository = require('../repositories/amazonTrackingSubmission.repository');
const extensionCommandRepository = require('../../extensionCommand/repositories/extensionCommand.repository');
const shipmentPublic = require('../../../shipment/public');
const authPublic = require('../../../auth/public');

jest.mock('../repositories/amazonTrackingSubmission.repository');
jest.mock('../../extensionCommand/repositories/extensionCommand.repository');
jest.mock('../../../shipment/public');
jest.mock('../../../auth/public');

describe('AmazonTrackingSubmission Service', () => {
  const shopId = '507f1f77bcf86cd799439011';
  const agentId = '507f1f77bcf86cd799439012';
  const shipmentId1 = '507f1f77bcf86cd799439013';
  const shipmentId2 = '507f1f77bcf86cd799439014';
  const commandId = '507f1f77bcf86cd799439015';
  const submissionId = '507f1f77bcf86cd799439016';
  const leaseToken = 'test-lease-token-1234567890';
  const leaseTokenHash = crypto.createHash('sha256').update(leaseToken).digest('hex');

  const authUser = {
    userId: 'user-1',
    tokenType: 'USER',
  };

  const authExtension = {
    extensionTokenId: 'ext-token-1',
    tokenType: 'EXTENSION',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
      });

  describe('createSubmission', () => {
    it('creates an Amazon tracking submission, generates valid TSV feed and links command', async () => {
      extensionCommandRepository.findAgentById.mockResolvedValue({
        _id: agentId,
        shopId,
      });

      shipmentPublic.findByIds.mockResolvedValue([
        {
          _id: shipmentId1,
          shopId,
          status: 'SHIPPED',
          externalOrderId: '111-2222222-3333331',
          carrier: 'USPS Ground Advantage',
          trackingNumber: '9400100000000000000001',
          shippedAt: new Date('2026-09-28T10:00:00Z'),
        },
        {
          _id: shipmentId2,
          shopId,
          status: 'SHIPPED',
          externalOrderId: '111-2222222-3333332',
          carrier: 'UPS',
          trackingNumber: '1Z9999999999999999',
          shippedAt: new Date('2026-09-28T11:00:00Z'),
        },
      ]);

      repository.create.mockResolvedValue({
        _id: submissionId,
        shopId,
        agentId,
        shipmentIds: [shipmentId1, shipmentId2],
        filename: 'shipping-confirmation-123.txt',
        tsv: 'order-id\tship-date\tcarrier-code\ttracking-number\tship-method\r\n',
        rowCount: 2,
        checksum: 'fake-checksum',
        status: 'PENDING',
      });

      extensionCommandRepository.createCommand.mockResolvedValue({
        _id: commandId,
        type: 'UPLOAD_TRACKING',
        status: 'QUEUED',
        shopId,
        agentId,
        trackingSubmissionId: submissionId,
      });

      repository.updateById.mockResolvedValue({
        _id: submissionId,
        shopId,
        agentId,
        commandId,
        shipmentIds: [shipmentId1, shipmentId2],
        filename: 'shipping-confirmation-123.txt',
        rowCount: 2,
        checksum: 'fake-checksum',
        status: 'PENDING',
      });

      shipmentPublic.updateMarketplaceConfirmation.mockResolvedValue({ modifiedCount: 2 });

      const result = await service.createSubmission(
        { shopId, agentId, shipmentIds: [shipmentId1, shipmentId2] },
        authUser
      );

      expect(authPublic.canAccessScope).toHaveBeenCalledWith(authUser, 'ORDERS:WRITE', { scopeType: 'shop', scopeId: shopId });
      expect(shipmentPublic.findByIds).toHaveBeenCalledWith([shipmentId1, shipmentId2]);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shopId,
          agentId,
          rowCount: 2,
          status: 'PENDING',
          tsv: expect.stringContaining('111-2222222-3333331\t2026-09-28\tUSPS\t9400100000000000000001\tStandard\r\n'),
        })
      );
      expect(extensionCommandRepository.createCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPLOAD_TRACKING',
          status: 'QUEUED',
          trackingSubmissionId: submissionId,
        })
      );
      expect(shipmentPublic.updateMarketplaceConfirmation).toHaveBeenCalledWith(
        [shipmentId1, shipmentId2],
        { status: 'SUBMITTED', submissionId }
      );
      expect(result.id).toBe(submissionId);
    });

    it('rejects if a shipment is not SHIPPED or missing tracking details', async () => {
      extensionCommandRepository.findAgentById.mockResolvedValue({ _id: agentId, shopId });
      shipmentPublic.findByIds.mockResolvedValue([
        {
          _id: shipmentId1,
          shopId,
          status: 'TRACKING_PENDING',
          externalOrderId: '111-2222222-3333331',
          carrier: null,
          trackingNumber: null,
        },
      ]);

      await expect(
        service.createSubmission({ shopId, agentId, shipmentIds: [shipmentId1] }, authUser)
      ).rejects.toThrow('is not in SHIPPED status');
    });
  });

  describe('Agent tracking lifecycle callbacks', () => {
    beforeEach(() => {
      extensionCommandRepository.findAgentForToken.mockResolvedValue({
        _id: agentId,
        shopId,
      });

      extensionCommandRepository.findCommandById.mockResolvedValue({
        _id: commandId,
        agentId,
        leaseTokenHash,
      });
    });

    it('returns leased payload for agent', async () => {
      repository.findByCommandId.mockResolvedValue({
        _id: submissionId,
        filename: 'shipping-confirmation-123.txt',
        tsv: 'order-id\tship-date\tcarrier-code\ttracking-number\tship-method\r\n',
        rowCount: 1,
        checksum: 'abc123checksum',
      });

      const payload = await service.getLeasedPayload(commandId, { clientId: 'client-1', label: 'label-1', leaseToken }, authExtension);

      expect(payload).toEqual({
        submissionId,
        filename: 'shipping-confirmation-123.txt',
        tsv: 'order-id\tship-date\tcarrier-code\ttracking-number\tship-method\r\n',
        rowCount: 1,
        checksum: 'abc123checksum',
      });
    });

    it('marks submission SUBMITTED', async () => {
      repository.findById.mockResolvedValue({ _id: submissionId, status: 'PENDING' });
      repository.updateById.mockResolvedValue({ _id: submissionId, status: 'SUBMITTED' });

      const res = await service.markSubmitted(commandId, submissionId, { clientId: 'client-1', label: 'label-1', leaseToken }, authExtension);
      expect(repository.updateById).toHaveBeenCalledWith(submissionId, expect.objectContaining({ status: 'SUBMITTED' }));
      expect(res.status).toBe('SUBMITTED');
    });

    it('marks submission and command WAITING_AMAZON', async () => {
      repository.findById.mockResolvedValue({ _id: submissionId, status: 'SUBMITTED' });
      repository.updateById.mockResolvedValue({ _id: submissionId, status: 'WAITING_AMAZON' });
      extensionCommandRepository.updateClaimed.mockResolvedValue({ _id: commandId, status: 'WAITING_AMAZON' });

      const res = await service.markWaiting(commandId, submissionId, { clientId: 'client-1', label: 'label-1', leaseToken }, authExtension);
      expect(repository.updateById).toHaveBeenCalledWith(submissionId, { status: 'WAITING_AMAZON' });
      expect(extensionCommandRepository.updateClaimed).toHaveBeenCalledWith(expect.objectContaining({
        commandId,
        patch: { status: 'WAITING_AMAZON', leaseExpiresAt: null },
      }));
      expect(res.status).toBe('WAITING_AMAZON');
    });

    it('records amazonBatchId', async () => {
      repository.findById.mockResolvedValue({ _id: submissionId });
      repository.updateById.mockResolvedValue({ _id: submissionId, amazonBatchId: '9876543210' });

      const res = await service.recordAmazonBatch(commandId, submissionId, { clientId: 'client-1', label: 'label-1', leaseToken, amazonBatchId: '9876543210' }, authExtension);
      expect(repository.updateById).toHaveBeenCalledWith(submissionId, { amazonBatchId: '9876543210' });
      expect(res.amazonBatchId).toBe('9876543210');
    });

    it('marks terminal SUCCEEDED and confirms shipments', async () => {
      repository.findById.mockResolvedValue({
        _id: submissionId,
        shipmentIds: [shipmentId1],
        rowCount: 1,
      });

      repository.updateById.mockResolvedValue({
        _id: submissionId,
        status: 'SUCCEEDED',
        result: { importedCount: 1, failedCount: 0, diagnostics: [] },
      });

      extensionCommandRepository.updateClaimed.mockResolvedValue({
        _id: commandId,
        status: 'SUCCEEDED',
      });

      shipmentPublic.updateMarketplaceConfirmation.mockResolvedValue({ modifiedCount: 1 });

      const res = await service.markTerminal(
        commandId,
        submissionId,
        {
          clientId: 'client-1',
          label: 'label-1',
          leaseToken,
          status: 'SUCCEEDED',
          result: { importedCount: 1, failedCount: 0, diagnostics: [] },
        },
        authExtension
      );

      expect(repository.updateById).toHaveBeenCalledWith(
        submissionId,
        expect.objectContaining({ status: 'SUCCEEDED' })
      );
      expect(extensionCommandRepository.updateClaimed).toHaveBeenCalledWith(
        expect.objectContaining({
          commandId,
          patch: expect.objectContaining({ status: 'SUCCEEDED' }),
          unset: { activeOrderKey: 1 },
        })
      );
      expect(shipmentPublic.updateMarketplaceConfirmation).toHaveBeenCalledWith(
        [shipmentId1],
        expect.objectContaining({ status: 'CONFIRMED' })
      );
      expect(res.status).toBe('SUCCEEDED');
    });

    it('marks terminal FAILED when Amazon rejects feed', async () => {
      repository.findById.mockResolvedValue({
        _id: submissionId,
        shipmentIds: [shipmentId1],
        rowCount: 1,
      });

      repository.updateById.mockResolvedValue({
        _id: submissionId,
        status: 'FAILED',
        result: { importedCount: 0, failedCount: 1, diagnostics: ['Invalid tracking number'] },
      });

      extensionCommandRepository.updateClaimed.mockResolvedValue({
        _id: commandId,
        status: 'FAILED',
      });

      shipmentPublic.updateMarketplaceConfirmation.mockResolvedValue({ modifiedCount: 1 });

      const res = await service.markTerminal(
        commandId,
        submissionId,
        {
          clientId: 'client-1',
          label: 'label-1',
          leaseToken,
          status: 'FAILED',
          result: { importedCount: 0, failedCount: 1, diagnostics: ['Invalid tracking number'] },
        },
        authExtension
      );

      expect(repository.updateById).toHaveBeenCalledWith(
        submissionId,
        expect.objectContaining({ status: 'FAILED' })
      );
      expect(shipmentPublic.updateMarketplaceConfirmation).toHaveBeenCalledWith(
        [shipmentId1],
        expect.objectContaining({ status: 'FAILED' })
      );
      expect(res.status).toBe('FAILED');
    });
  });
});
