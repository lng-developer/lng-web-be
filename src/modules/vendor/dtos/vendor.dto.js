function toId(value) {
  return value === undefined || value === null ? null : String(value);
}

function toCompactVendor(value) {
  if (!value) return null;
  if (typeof value === 'object' && (value.code || value.name)) {
    return {
      id: toId(value._id || value.id),
      code: value.code,
      name: value.name,
      providerKey: value.providerKey || null,
      fulfillmentType: value.fulfillmentType || null,
      status: value.status,
    };
  }
  return { id: toId(value) };
}

function toCompactProductTypeGroup(value) {
  if (!value) return null;
  if (typeof value === 'object' && (value.code || value.name)) {
    return {
      id: toId(value._id || value.id),
      code: value.code,
      name: value.name,
      printMethod: value.printMethod || null,
      status: value.status,
    };
  }
  return { id: toId(value) };
}

function toVendorDto(vendor, { detail = false } = {}) {
  if (!vendor) return null;

  const dto = {
    id: toId(vendor._id || vendor.id),
    code: vendor.code,
    name: vendor.name,
    providerKey: vendor.providerKey || null,
    fulfillmentType: vendor.fulfillmentType || null,
    unitSurchargeAmount: vendor.unitSurchargeAmount ?? null,
    status: vendor.status,
  };

  if (detail) {
    dto.metadata = vendor.metadata || {};
    dto.createdAt = vendor.createdAt;
    dto.updatedAt = vendor.updatedAt;
  }

  return dto;
}

function toVendorProductDto(product, { detail = false, costCenterCount = 0 } = {}) {
  if (!product) return null;

  const dto = {
    id: toId(product._id || product.id),
    vendor: toCompactVendor(product.vendorId),
    productTypeGroup: toCompactProductTypeGroup(product.productTypeGroupId),
    code: product.code,
    name: product.name,
    externalProductId: product.externalProductId || null,
    imageUrl: product.imageUrl || null,
    productUrl: product.productUrl || null,
    designTemplateUrl: product.designTemplateUrl || null,
    minProductionDays: product.minProductionDays ?? null,
    maxProductionDays: product.maxProductionDays ?? null,
    baseCostAmount: product.baseCostAmount,
    unitSurchargeAmount: product.unitSurchargeAmount ?? null,
    currency: product.currency,
    costCenterCount,
    status: product.status,
  };

  if (detail) {
    dto.metadata = product.metadata || {};
    dto.createdAt = product.createdAt;
    dto.updatedAt = product.updatedAt;
  }

  return dto;
}

function toVendorCostCenterDto(costCenter, { detail = false } = {}) {
  if (!costCenter) return null;

  const dto = {
    id: toId(costCenter._id || costCenter.id),
    vendorProductId: toId(costCenter.vendorProductId),
    code: costCenter.code,
    name: costCenter.name,
    sku: costCenter.sku || null,
    lngCode: costCenter.lngCode || null,
    vendorSize: costCenter.vendorSize || null,
    vendorColor: costCenter.vendorColor || null,
    standardSize: costCenter.standardSize || null,
    standardColor: costCenter.standardColor || null,
    printMethod: costCenter.printMethod || null,
    attributes: costCenter.attributes || {},
    weight: costCenter.weight ?? null,
    weightUnit: costCenter.weightUnit || null,
    width: costCenter.width ?? null,
    length: costCenter.length ?? null,
    height: costCenter.height ?? null,
    dimensionUnit: costCenter.dimensionUnit || null,
    baseCostAmount: costCenter.baseCostAmount,
    unitSurchargeAmount: costCenter.unitSurchargeAmount ?? null,
    currency: costCenter.currency,
    domesticShipping: costCenter.domesticShipping || {},
    internationalShipping: costCenter.internationalShipping || {},
    priorityShipping: costCenter.priorityShipping || {},
    importTaxAmount: costCenter.importTaxAmount,
    additionalCosts: costCenter.additionalCosts || {},
    status: costCenter.status,
  };

  if (detail) {
    dto.metadata = costCenter.metadata || {};
    dto.createdAt = costCenter.createdAt;
    dto.updatedAt = costCenter.updatedAt;
  }

  return dto;
}

function toVendorIntegrationConfigDto(config) {
  if (!config) return null;

  return {
    id: toId(config._id || config.id),
    vendorId: toId(config.vendorId?._id || config.vendorId),
    providerKey: config.providerKey,
    baseUrl: config.baseUrl,
    authType: config.authType,
    status: config.status,
    expiresAt: config.expiresAt || null,
    lastCheckedAt: config.lastCheckedAt || null,
    lastError: config.lastError || null,
    accessTokenConfigured: Boolean(config.accessTokenEncrypted),
    refreshTokenConfigured: Boolean(config.refreshTokenEncrypted),
    usernameConfigured: Boolean(config.usernameEncrypted),
    passwordConfigured: Boolean(config.passwordEncrypted),
    metadata: config.metadata || {},
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

function toPaginatedResponse(result, mapper) {
  return {
    items: (result.items || []).map(mapper),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

module.exports = {
  toCompactVendor,
  toCompactProductTypeGroup,
  toId,
  toPaginatedResponse,
  toVendorDto,
  toVendorCostCenterDto,
  toVendorIntegrationConfigDto,
  toVendorProductDto,
};
