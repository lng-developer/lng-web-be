const {
  toFileCheckDto,
  toProductionTaskSummaryDto,
} = require('../../../modules/production/dtos/productionTask.dto');

describe('productionTask.dto', () => {
  test('adds media download URLs for file check assets', () => {
    const dto = toFileCheckDto({
      _id: '660000000000000000100003',
      slotKey: 'PSD_TEMPLATE',
      sourceType: 'PSD_TEMPLATE',
      inputAssetId: '660000000000000000000901',
      outputAssetId: '660000000000000000000902',
      scaleStatus: 'NEED_SCALE',
      qcStatus: 'NOT_READY',
    });

    expect(dto).toMatchObject({
      inputAssetId: '660000000000000000000901',
      inputAssetDownloadUrl: '/api/media/assets/660000000000000000000901/download',
      outputAssetId: '660000000000000000000902',
      outputAssetDownloadUrl: '/api/media/assets/660000000000000000000902/download',
    });
  });

  test('summary task exposes PSD_TEMPLATE download URL through scaleContext', () => {
    const dto = toProductionTaskSummaryDto({
      _id: '660000000000000000100001',
      orderItemId: '660000000000000000000401',
      fileChecks: [{
        slotKey: 'PSD_TEMPLATE',
        sourceType: 'PSD_TEMPLATE',
        inputAssetId: '660000000000000000000901',
      }],
    });

    expect(dto).not.toHaveProperty('fileChecks');
    expect(dto.scaleContext.use.psdTemplate).toMatchObject({
      assetId: '660000000000000000000901',
      assetDownloadUrl: '/api/media/assets/660000000000000000000901/download',
    });
  });

  test('summary task exposes channel, order, seller, group, and timestamps', () => {
    const dto = toProductionTaskSummaryDto({
      _id: '660000000000000000100001',
      orderItemId: '660000000000000000000401',
      orderItemSnapshot: {
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        status: 'NEED_PRODUCTION',
        sku: 'J2605-ABC',
        groupId: 'scale-group-1',
        groupType: 'SCALE',
      },
      orderSnapshot: {
        status: 'PROCESSING',
        assignedStaffId: '660000000000000000000904',
      },
      orderOwnerUser: {
        accountId: '660000000000000000000904',
        fullName: 'Order Owner',
        employeeCode: 'CS01',
      },
      sellerUser: {
        employeeCode: 'J2605',
        fullName: 'Seller User',
      },
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    });

    expect(dto).toMatchObject({
      salesChannelCode: 'AMAZON',
      marketplaceCode: 'AMAZON_US',
      orderStatus: 'PROCESSING',
      orderOwner: { id: '660000000000000000000904', fullName: 'Order Owner', employeeCode: 'CS01' },
      seller: { employeeCode: 'J2605', name: 'Seller User' },
      groupId: 'scale-group-1',
      groupType: 'SCALE',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    });
    expect(dto).not.toHaveProperty('scaleBy');
  });

  test('summary task exposes clean assignment user aliases while keeping legacy names', () => {
    const dto = toProductionTaskSummaryDto({
      _id: '660000000000000000100001',
      assignedDesignUserId: '660000000000000000000901',
      qcBy: '660000000000000000000902',
      csAssigneeId: '660000000000000000000903',
      csAssignedBy: '660000000000000000000904',
      csAssignedAt: new Date('2026-07-05T00:00:00.000Z'),
      csStatus: 'IN_PROGRESS',
      csNote: 'Confirm customer crop before scale',
      scaleByUser: {
        accountId: '660000000000000000000901',
        fullName: 'Scale User',
        employeeCode: 'SC01',
      },
      qcByUser: {
        accountId: '660000000000000000000902',
        fullName: 'QC User',
        employeeCode: 'QC01',
      },
      csAssigneeUser: {
        accountId: '660000000000000000000903',
        fullName: 'CS User',
        employeeCode: 'CS02',
      },
      vendorSubmission: {
        id: '660000000000000000129001',
        status: 'FAILED',
        failedAt: new Date('2026-07-06T00:00:00.000Z'),
        failureReason: 'Vendor rejected payload',
      },
    });

    expect(dto.assignedDesigner).toEqual({
      id: '660000000000000000000901',
      fullName: 'Scale User',
      employeeCode: 'SC01',
    });
    expect(dto.qcUser).toEqual({
      id: '660000000000000000000902',
      fullName: 'QC User',
      employeeCode: 'QC01',
    });
    expect(dto.csAssignee).toEqual({
      id: '660000000000000000000903',
      fullName: 'CS User',
      employeeCode: 'CS02',
    });
    expect(dto).toMatchObject({
      csAssigneeId: '660000000000000000000903',
      csAssignedBy: '660000000000000000000904',
      csStatus: 'IN_PROGRESS',
      csNote: 'Confirm customer crop before scale',
      vendorSubmission: {
        id: '660000000000000000129001',
        status: 'FAILED',
        failureReason: 'Vendor rejected payload',
      },
    });
    expect(dto).not.toHaveProperty('scaleByUser');
    expect(dto).not.toHaveProperty('qcByUser');
  });

  test('summary task defaults missing CS workflow fields to unassigned', () => {
    const dto = toProductionTaskSummaryDto({
      _id: '660000000000000000100001',
    });

    expect(dto).toMatchObject({
      csAssigneeId: null,
      csStatus: 'UNASSIGNED',
      csNote: null,
    });
    expect(dto).not.toHaveProperty('csAssignee');
  });

  test('summary task keeps design-critical mapping data but strips raw snapshot noise', () => {
    const dto = toProductionTaskSummaryDto({
      _id: '660000000000000000100001',
      orderItemId: '660000000000000000000401',
      orderItemSnapshot: {
        externalOrderId: 'ORDER-1',
        externalItemId: 'ITEM-1',
        externalAccountId: 'SELLER-1',
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        asin: 'B001',
        sku: 'J2605-ABC',
        title: 'Custom item',
        status: 'NEED_PRODUCTION',
      },
      listingSnapshot: {
        _id: '660000000000000000000501',
        shopId: '660000000000000000000201',
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        sku: 'J2605-ABC',
        asin: 'B001',
        title: 'Listing title',
        internalTemplateId: {
          _id: '660000000000000000000601',
          code: 'TPL',
          name: 'Template',
          __v: 9,
        },
        psdStatus: 'READY',
        costCenterStatus: 'READY',
        status: 'ACTIVE',
        qcStatus: 'APPROVED',
        rejectionReason: 'raw-noise',
        createdAt: new Date(),
        __v: 1,
      },
      templateSnapshot: {
        _id: '660000000000000000000601',
        code: 'TPL',
        name: 'Template',
        artworkSlots: [{ key: 'FRONT', label: 'Front' }],
        designAssets: [{ assetId: '660000000000000000000901' }],
        requiredFields: ['name'],
        description: 'raw-noise',
        __v: 1,
      },
      customizationSnapshot: {
        payloadId: '660000000000000000000701',
        status: 'PARSED',
        needsReview: false,
        customerInputs: { texts: [{ label: 'Name', value: 'Ava' }] },
        imageAssets: [{
          assetId: '660000000000000000000902',
          filename: 'photo.png',
          mimeType: 'image/png',
          size: 12,
          sha256: 'raw-noise',
        }],
      },
      vendorProductSnapshot: {
        id: '660000000000000000000801',
        code: 'VP1',
        name: 'Vendor Product',
        vendor: { id: 'vendor-1', name: 'Vendor' },
        raw: 'noise',
      },
      vendorCostCenterSnapshot: {
        id: '660000000000000000000802',
        code: 'CC1',
        baseCostAmount: 100,
        currency: 'USD',
        raw: 'noise',
      },
    });

    expect(dto).toMatchObject({
      orderItem: {
        externalOrderId: 'ORDER-1',
        externalItemId: 'ITEM-1',
        sku: 'J2605-ABC',
        title: 'Custom item',
      },
      customization: {
        payloadId: '660000000000000000000701',
        customerInputs: { texts: [{ label: 'Name', value: 'Ava' }] },
        imageAssets: [{
          assetId: '660000000000000000000902',
          assetDownloadUrl: '/api/media/assets/660000000000000000000902/download',
          filename: 'photo.png',
        }],
      },
      vendorProduct: {
        id: '660000000000000000000801',
        code: 'VP1',
        name: 'Vendor Product',
      },
      vendorCostCenter: {
        id: '660000000000000000000802',
        code: 'CC1',
        baseCostAmount: 100,
        currency: 'USD',
      },
      scaleContext: {
        use: {
          listing: {
            id: '660000000000000000000501',
            sku: 'J2605-ABC',
            title: 'Listing title',
            psdStatus: 'READY',
            costCenterStatus: 'READY',
          },
          template: {
            id: '660000000000000000000601',
            code: 'TPL',
            artworkSlots: [{ key: 'FRONT', label: 'Front' }],
            designAssets: [{ assetId: '660000000000000000000901' }],
          },
        },
      },
    });
    expect(dto).not.toHaveProperty('listing');
    expect(dto).not.toHaveProperty('internalTemplate');
    expect(dto.scaleContext.use.listing).not.toHaveProperty('__v');
    expect(dto.scaleContext.use.listing).not.toHaveProperty('rejectionReason');
    expect(dto.scaleContext.use.listing).not.toHaveProperty('internalTemplate');
    expect(dto.customization.imageAssets[0]).not.toHaveProperty('sha256');
    expect(dto.vendorProduct).not.toHaveProperty('raw');
    expect(dto.vendorCostCenter).not.toHaveProperty('raw');
  });

  test('scaleContext tells FE why a task is blocked and which data is still usable', () => {
    const dto = toProductionTaskSummaryDto({
      _id: '660000000000000000100001',
      status: 'BLOCKED',
      scaleStatus: 'NEED_SCALE',
      blockers: ['TEMPLATE_NOT_FOUND', 'PSD_MISSING'],
      customizationSnapshot: {
        customerInputs: { texts: [{ label: 'Name', value: 'Christie' }] },
        imageAssets: [{ assetId: '660000000000000000000902', filename: 'photo.jpg' }],
      },
      vendorProductSnapshot: {
        id: '660000000000000000000801',
        code: 'VP1',
        name: 'Vendor Product',
      },
      vendorCostCenterSnapshot: {
        id: '660000000000000000000802',
        code: 'CC1',
        baseCostAmount: 100,
        currency: 'USD',
      },
      fileChecks: [{
        _id: '660000000000000000100003',
        slotKey: 'PSD_TEMPLATE',
        sourceType: 'PSD_TEMPLATE',
        inputAssetId: null,
        scaleStatus: 'NOT_REQUIRED',
        qcStatus: 'NOT_READY',
        blockers: ['PSD_MISSING'],
      }],
    });

    expect(dto.scaleContext).toMatchObject({
      status: 'BLOCKED',
      canScale: false,
      missingRequirements: [
        { code: 'INTERNAL_TEMPLATE' },
        { code: 'PSD_TEMPLATE' },
      ],
      use: {
        template: null,
        psdTemplate: { assetId: null, status: 'MISSING' },
      },
    });
    expect(dto.customization.imageAssets[0]).toMatchObject({
      assetId: '660000000000000000000902',
      assetDownloadUrl: '/api/media/assets/660000000000000000000902/download',
    });
    expect(dto.scaleContext.use).not.toHaveProperty('customerImages');
    expect(dto.scaleContext.use).not.toHaveProperty('customization');
    expect(dto.scaleContext.use).not.toHaveProperty('vendorProduct');
    expect(dto.scaleContext.use).not.toHaveProperty('vendorCostCenter');
  });

  test('scaleContext tells FE which customer image slot is ready to scale', () => {
    const dto = toProductionTaskSummaryDto({
      _id: '660000000000000000100001',
      status: 'NEED_SCALE',
      scaleStatus: 'NEED_SCALE',
      blockers: ['SCALED_OUTPUT_MISSING'],
      listingSnapshot: {
        _id: '660000000000000000000501',
        sku: 'J2605-ABC',
        title: 'Listing',
        psdTemplateAssetId: '660000000000000000000901',
      },
      templateSnapshot: {
        _id: '660000000000000000000601',
        code: 'TPL',
        artworkSlots: [{ key: 'FRONT', label: 'Front' }],
      },
      customizationSnapshot: {
        customerInputs: { texts: [{ label: 'Name', value: 'Ava' }] },
        imageAssets: [{ assetId: '660000000000000000000902', filename: 'photo.jpg' }],
      },
      vendorProductSnapshot: {
        id: '660000000000000000000801',
        code: 'VP1',
      },
      vendorCostCenterSnapshot: {
        id: '660000000000000000000802',
        code: 'CC1',
      },
      fileChecks: [{
        _id: '660000000000000000100004',
        slotKey: 'FRONT',
        slotLabel: 'Front',
        sourceType: 'CUSTOMER_IMAGE',
        inputAssetId: '660000000000000000000902',
        outputAssetId: null,
        scaleStatus: 'NEED_SCALE',
        qcStatus: 'NOT_READY',
        blockers: ['SCALED_OUTPUT_MISSING'],
      }],
    });

    expect(dto.scaleContext).toMatchObject({
      status: 'READY_TO_SCALE',
      canScale: true,
      missingRequirements: [],
      use: {
        template: { id: '660000000000000000000601', code: 'TPL' },
        psdTemplate: {
          assetId: '660000000000000000000901',
          assetDownloadUrl: '/api/media/assets/660000000000000000000901/download',
          status: 'READY',
        },
        scaleSlots: [{
          fileCheckId: '660000000000000000100004',
          slotKey: 'FRONT',
          inputAssetId: '660000000000000000000902',
          inputAssetDownloadUrl: '/api/media/assets/660000000000000000000902/download',
        }],
      },
    });
  });
});
