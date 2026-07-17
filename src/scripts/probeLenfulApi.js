require('dotenv').config();

const { fetchTrackingByExternalOrderId } = require('../modules/shipment/services/vendorTrackingAdapterRegistry.service');

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  const externalOrderId = readArg('externalOrderId', '');
  if (!externalOrderId) throw new Error('Usage: node src/scripts/probeLenfulApi.js --externalOrderId=<externalOrderId>');

  const tracking = await fetchTrackingByExternalOrderId('LENFUL', externalOrderId);
  console.log(JSON.stringify({
    provider: 'LENFUL',
    externalOrderId,
    tracking,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
