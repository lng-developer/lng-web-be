require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const tasks = await mongoose.connection.collection('productiontasks').find({
    'orderItemSnapshot.salesChannelCode': 'ETSY'
  }).toArray();

  let updatedCount = 0;
  for (const t of tasks) {
    const item = await mongoose.connection.collection('orderitems').findOne({ _id: t.orderItemId });
    const listing = t.listingSnapshot?.id
      ? await mongoose.connection.collection('listings').findOne({ _id: new mongoose.Types.ObjectId(t.listingSnapshot.id) })
      : null;
    const etsyListingId = item?.externalListingId || listing?.etsyListingId || item?.externalData?.etsy?.listingId;
    if (etsyListingId) {
      await mongoose.connection.collection('productiontasks').updateOne(
        { _id: t._id },
        {
          $set: {
            'orderItemSnapshot.etsyListingId': etsyListingId,
            'listingSnapshot.etsyListingId': etsyListingId
          }
        }
      );
      updatedCount++;
    }
  }
  console.log(`Successfully backfilled ${updatedCount} production tasks with etsyListingId`);
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
