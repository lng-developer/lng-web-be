const { deriveOrderItemWorkflow } = require('../../../src/modules/order/services/orderWorkflow.service');

describe('orderWorkflow.service', () => {
  const readyFacts = {
    item: { status: 'CUSTOMIZATION_PENDING', customizationRawSummary: { hasCustomization: false } },
    order: { addressValidationStatus: 'VALID' },
    mapping: {
      status: 'READY',
      vendorProduct: { id: 'vendor-product-1' },
      vendorCostCenter: { id: 'cost-center-1' },
    },
    listing: { psdStatus: 'PRESENT', psdTemplateAssetId: 'psd-1' },
  };

  test('only reports missing PSD from the production readiness blocker', () => {
    const workflow = deriveOrderItemWorkflow({
      ...readyFacts,
      listing: { psdStatus: 'MISSING', psdTemplateAssetId: null },
      production: { blockers: ['PSD_MISSING'] },
    });

    expect(workflow).toMatchObject({
      stage: 'NEED_PSD',
      owner: 'DESIGN',
      blockers: [{ code: 'PSD_MISSING' }],
      nextActions: ['REQUEST_PSD_FROM_CATALOG'],
    });
  });

  test('does not wait for customization when the imported item has none', () => {
    expect(deriveOrderItemWorkflow(readyFacts).stage).toBe('NEED_PRODUCTION');
  });

  test('keeps an actually required but unparsed customization ahead of PSD work', () => {
    const workflow = deriveOrderItemWorkflow({
      ...readyFacts,
      item: { status: 'CUSTOMIZATION_PENDING', customizationRawSummary: { hasCustomization: true } },
      customization: { status: 'PENDING' },
      listing: { psdStatus: 'MISSING' },
    });

    expect(workflow.stage).toBe('NEED_CUSTOMIZATION');
    expect(workflow.owner).toBe('CS');
  });

  test('routes an incomplete vendor plan back to mapping', () => {
    const workflow = deriveOrderItemWorkflow({
      ...readyFacts,
      mapping: { status: 'READY', vendorProduct: { id: 'vendor-product-1' } },
    });

    expect(workflow).toMatchObject({
      stage: 'NEED_MAPPING',
      owner: 'MAPPING',
      blockers: [{ code: 'MAPPING_NOT_READY' }],
    });
  });

  test('keeps invalid address ahead of downstream work', () => {
    expect(deriveOrderItemWorkflow({
      ...readyFacts,
      order: { addressValidationStatus: 'WARNING' },
    })).toMatchObject({ stage: 'NEED_ADDRESS', owner: 'CS' });
  });

  test('routes a missing template to Design before trying to scale', () => {
    expect(deriveOrderItemWorkflow({
      ...readyFacts,
      production: { status: 'BLOCKED', blockers: ['TEMPLATE_NOT_FOUND'] },
    })).toMatchObject({ stage: 'NEED_TEMPLATE', owner: 'DESIGN' });
  });

  test('routes a ready plan with a missing internal template back to Design', () => {
    expect(deriveOrderItemWorkflow({
      ...readyFacts,
      mapping: {
        ...readyFacts.mapping,
        checks: { internalTemplate: { ok: false, status: 'MISSING' } },
      },
    })).toMatchObject({
      stage: 'NEED_TEMPLATE',
      owner: 'DESIGN',
      nextActions: ['CREATE_TEMPLATE'],
    });
  });

  test('routes a missing required customer image back to CS', () => {
    expect(deriveOrderItemWorkflow({
      ...readyFacts,
      production: { status: 'BLOCKED', blockers: ['CUSTOMER_IMAGE_MISSING'] },
    })).toMatchObject({ stage: 'NEED_CUSTOMER_IMAGE', owner: 'CS' });
  });

  test('routes a task with all inputs and no assignment to Scale', () => {
    const workflow = deriveOrderItemWorkflow({
      ...readyFacts,
      production: { status: 'NEED_SCALE', scaleStatus: 'NEED_SCALE', blockers: [] },
    });

    expect(workflow).toMatchObject({
      stage: 'READY_FOR_SCALE',
      owner: 'SCALE',
      nextActions: ['ASSIGN_SCALE'],
    });
  });

  test('marks an assigned scale task as in progress', () => {
    expect(deriveOrderItemWorkflow({
      ...readyFacts,
      production: {
        status: 'NEED_SCALE',
        scaleStatus: 'NEED_SCALE',
        assignedDesignUserId: 'designer-1',
        blockers: [],
      },
    })).toMatchObject({ stage: 'IN_SCALE', owner: 'SCALE' });
  });

  test('hands a scaled output to QC before vendor submission', () => {
    expect(deriveOrderItemWorkflow({
      ...readyFacts,
      production: { status: 'QC_PENDING', qcStatus: 'PENDING', blockers: [] },
    })).toMatchObject({ stage: 'QC_PENDING', owner: 'SCALE', nextActions: ['REVIEW_QC'] });
  });

  test('hands QC-passed work to vendor operations', () => {
    expect(deriveOrderItemWorkflow({
      ...readyFacts,
      production: { status: 'READY_TO_SEND_VENDOR', qcStatus: 'PASSED', blockers: [] },
    })).toMatchObject({ stage: 'READY_TO_SEND_VENDOR', owner: 'VENDOR' });
  });

  test('keeps QC rejection ahead of vendor submission', () => {
    const workflow = deriveOrderItemWorkflow({
      ...readyFacts,
      production: { status: 'QC_REJECTED', qcStatus: 'REJECTED', blockers: ['QC_REJECTED'] },
    });

    expect(workflow).toMatchObject({
      stage: 'QC_REJECTED',
      owner: 'SCALE',
      nextActions: ['RESCALE'],
    });
  });

  test.each([
    ['TRACKING_PENDING', 'TRACKING_PENDING'],
    ['SHIPPED', 'SHIPPED'],
    ['DELIVERED', 'DELIVERED'],
  ])('uses shipment status %s as the terminal shipping stage', (shipmentStatus, expectedStage) => {
    expect(deriveOrderItemWorkflow({ ...readyFacts, shipment: { status: shipmentStatus } }).stage)
      .toBe(expectedStage);
  });

  test.each(['CANCELLED', 'FAILED', 'REFUNDED'])('preserves terminal order item stage %s', (status) => {
    expect(deriveOrderItemWorkflow({ ...readyFacts, item: { status } }).stage).toBe(status);
  });
});
