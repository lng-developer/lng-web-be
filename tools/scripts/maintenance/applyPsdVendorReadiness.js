const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const Listing = require('../../../src/modules/catalog/models/listing.model');
const ListingVariant = require('../../../src/modules/catalog/models/listingVariant.model');
const ProductTypeGroup = require('../../../src/modules/catalog/models/productTypeGroup.model');
const InternalTemplate = require('../../../src/modules/catalog/models/internalTemplate.model');
const MediaAsset = require('../../../src/modules/media/models/mediaAsset.model');
const VendorProduct = require('../../../src/modules/vendor/models/vendorProduct.model');
const VendorCostCenter = require('../../../src/modules/vendor/models/vendorCostCenter.model');
const FulfillmentPlan = require('../../../src/modules/mapping/models/fulfillmentPlan.model');
const mappingPublic = require('../../../src/modules/mapping/public');
const productionPublic = require('../../../src/modules/production/public');
const orderPublic = require('../../../src/modules/order/public');
const { recordStatuses } = require('../../../src/modules/catalog/constants/catalog.constants');

const defaultPsdPath = 'C:/Users/admin/Downloads/report/psd template.psd';
const apply = process.argv.includes('--apply');
const psdPath = valueArg('--psd') || defaultPsdPath;
const batchSize = Number(valueArg('--batch') || 100);
const authContext = {
  system: true,
  source: 'PSD_VENDOR_READINESS_SCRIPT',
  permissions: ['MAPPING:WRITE', 'PRODUCTION:WRITE'],
};

function valueArg(name) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : null;
}

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

async function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function ensurePsdAsset(summary) {
  const stat = fs.statSync(psdPath);
  const hash = await sha256(psdPath);
  let asset = await MediaAsset.findOne({ sha256: hash, size: stat.size, assetPurpose: 'PSD_TEMPLATE' }).lean();
  if (asset || !apply) {
    summary.mediaAsset = asset ? toId(asset) : null;
    summary.wouldCreateMediaAsset = !asset;
    return asset || { _id: null, sha256: hash, size: stat.size };
  }

  const storageRoot = path.resolve(process.env.MEDIA_STORAGE_ROOT || path.resolve(process.cwd(), 'storage', 'media'));
  fs.mkdirSync(storageRoot, { recursive: true });
  const storageFilename = `psd-template-${hash.slice(0, 12)}.psd`;
  fs.copyFileSync(psdPath, path.join(storageRoot, storageFilename));
  asset = await MediaAsset.create({
    originalFilename: path.basename(psdPath),
    storageFilename,
    mimeType: 'image/vnd.adobe.photoshop',
    size: stat.size,
    sha256: hash,
    relativeStoragePath: storageFilename,
    provider: 'local',
    assetPurpose: 'PSD_TEMPLATE',
    uploadStatus: 'READY',
    metadata: { source: authContext.source },
  });
  summary.mediaAsset = toId(asset);
  summary.createdMediaAsset = true;
  return asset.toObject();
}

async function fallbackProductTypeGroup() {
  return ProductTypeGroup.findOne({ status: recordStatuses.ACTIVE }).sort({ sortOrder: 1, name: 1 }).lean();
}

async function templateFor(productTypeGroupId) {
  return InternalTemplate.findOne({ productTypeGroupId, status: recordStatuses.ACTIVE }).sort({ createdAt: 1 }).lean();
}

async function vendorFor(productTypeGroupId) {
  let product = await VendorProduct.findOne({ productTypeGroupId, status: recordStatuses.ACTIVE }).sort({ createdAt: 1 }).lean();
  if (!product) product = await VendorProduct.findOne({ status: recordStatuses.ACTIVE }).sort({ createdAt: 1 }).lean();
  if (!product) return null;
  const costCenter = await VendorCostCenter.findOne({
    vendorProductId: product._id,
    status: recordStatuses.ACTIVE,
  }).sort({ createdAt: 1 }).lean();
  return costCenter ? { product, costCenter } : null;
}

async function ensureListingVariants(psdAssetId, summary) {
  const fallbackGroup = await fallbackProductTypeGroup();
  if (!fallbackGroup) throw new Error('No active product type group found');

  const cursor = Listing.collection.find({}, {
    projection: {
      _id: 1,
      defaultVariantId: 1,
      productTypeGroupId: 1,
      internalTemplateId: 1,
      previewAssetId: 1,
    },
  }).batchSize(batchSize);

  for await (const listing of cursor) {
    summary.listingsScanned += 1;
    const variants = await ListingVariant.find({ listingId: listing._id }).sort({ createdAt: 1 }).lean();
    if (variants.length) {
      summary.variantsTouched += variants.length;
      if (apply) {
        await ListingVariant.updateMany({ listingId: listing._id }, { $set: { psdTemplateAssetId: psdAssetId } });
        if (!listing.defaultVariantId) {
          await Listing.updateOne({ _id: listing._id }, { $set: { defaultVariantId: variants[0]._id } });
          summary.defaultVariantsSet += 1;
        }
      }
      continue;
    }

    const productTypeGroupId = listing.productTypeGroupId || fallbackGroup._id;
    const template = listing.internalTemplateId ? null : await templateFor(productTypeGroupId);
    summary.variantsCreated += 1;
    if (!apply) continue;
    const variant = await ListingVariant.create({
      listingId: listing._id,
      productTypeGroupId,
      internalTemplateId: listing.internalTemplateId || template?._id || null,
      psdTemplateAssetId: psdAssetId,
      previewAssetId: listing.previewAssetId || null,
      status: recordStatuses.ACTIVE,
    });
    await Listing.updateOne({ _id: listing._id }, { $set: { defaultVariantId: variant._id } });
    summary.defaultVariantsSet += 1;
  }
}

async function matchOrders(summary) {
  const orderItems = mongoose.connection.db.collection('orderitems');
  const cursor = orderItems.find({}, {
    projection: { _id: 1, orderId: 1, listingId: 1 },
  }).batchSize(batchSize);

  for await (const item of cursor) {
    summary.orderItemsScanned += 1;
    if (!item.listingId) {
      summary.orderItemsSkippedNoListing += 1;
      continue;
    }
    const variant = await ListingVariant.findOne({ listingId: item.listingId, status: recordStatuses.ACTIVE }).sort({ createdAt: 1 }).lean();
    if (!variant) {
      summary.orderItemsSkippedNoVariant += 1;
      continue;
    }
    const vendor = await vendorFor(variant.productTypeGroupId);
    if (!vendor) {
      summary.orderItemsSkippedNoVendor += 1;
      continue;
    }

    summary.orderItemsMatched += 1;
    if (!apply) continue;
    try {
      const existingPlan = await FulfillmentPlan.findOne({ orderItemId: item._id }).lean();
      if (existingPlan?.status === 'READY' && existingPlan.vendorProductId && existingPlan.vendorCostCenterId) {
        const listing = await Listing.findById(item.listingId).lean();
        await FulfillmentPlan.updateOne({ _id: existingPlan._id }, {
          $set: {
            listingId: item.listingId,
            listingVariantId: variant._id,
            internalTemplateId: variant.internalTemplateId || null,
            productTypeGroupId: variant.productTypeGroupId,
            'snapshot.listing': listing ? {
              id: toId(listing),
              sku: listing.sku || null,
              title: listing.title || null,
              productTypeGroupId: toId(variant.productTypeGroupId),
              internalTemplateId: toId(variant.internalTemplateId),
            } : null,
            'snapshot.internalTemplate': variant.internalTemplateId ? {
              id: toId(variant.internalTemplateId),
              code: null,
              name: null,
              status: null,
            } : null,
          },
        });
      } else {
        await mappingPublic.selectFulfillmentPlan(item._id, {
          vendorProductId: vendor.product._id,
          vendorCostCenterId: vendor.costCenter._id,
        }, authContext);
      }
      if (item.orderId) await orderPublic.updatePsdStatusForOrder(item.orderId);
      await productionPublic.createOrRecheckTaskForOrderItem(item._id, authContext);
      summary.productionTasksTouched += 1;
    } catch (error) {
      summary.orderItemsFailed += 1;
      if (summary.failures.length < 10) {
        summary.failures.push({ orderItemId: toId(item._id), message: error.message });
      }
    }
  }
}

async function run() {
  if (!fs.existsSync(psdPath)) throw new Error(`PSD not found: ${psdPath}`);
  await connectDatabase();
  const summary = {
    apply,
    database: mongoose.connection.db.databaseName,
    psdPath,
    mediaAsset: null,
    wouldCreateMediaAsset: false,
    createdMediaAsset: false,
    listingsScanned: 0,
    variantsTouched: 0,
    variantsCreated: 0,
    defaultVariantsSet: 0,
    orderItemsScanned: 0,
    orderItemsMatched: 0,
    orderItemsSkippedNoListing: 0,
    orderItemsSkippedNoVariant: 0,
    orderItemsSkippedNoVendor: 0,
    orderItemsFailed: 0,
    productionTasksTouched: 0,
    failures: [],
  };

  const asset = await ensurePsdAsset(summary);
  if (!asset._id && apply) throw new Error('PSD media asset was not created');
  await ensureListingVariants(asset._id, summary);
  await matchOrders(summary);
  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
