const fs = require('fs');
const path = require('path');
const { buildRouteInventory } = require('./routeInventory');

const apiDir = path.resolve(__dirname, '../../../docs/api');
const postmanDir = path.join(apiDir, 'postman');
const outputPath = path.join(apiDir, 'LNG_Web_BE_All.postman_collection.json');
const indexPath = path.join(apiDir, 'ENDPOINT_INDEX.md');

function collectionFiles() {
  return fs.readdirSync(postmanDir)
    .filter((name) => name.endsWith('.postman_collection.json'))
    .sort();
}

function buildAggregate() {
  const collections = collectionFiles().map((name) => ({
    moduleName: name.replace('.postman_collection.json', ''),
    collection: JSON.parse(fs.readFileSync(path.join(postmanDir, name), 'utf8')),
  }));
  const variableMap = new Map(collections.flatMap(({ collection }) => (
    (collection.variable || []).map(({ key, value }) => [key, value])
  )));
  return {
    info: {
      name: 'LNG Web BE - All Modules',
      description: 'Complete backend API collection. Use module folders for frontend integration and import a matching environment file.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [...variableMap].map(([key, value]) => ({ key, value })),
    item: collections.map(({ moduleName, collection }) => ({
      name: moduleName,
      item: collection.item || [],
    })),
  };
}

function buildIndex() {
  const grouped = Object.entries(Object.groupBy(buildRouteInventory(), ({ module }) => module))
    .sort(([left], [right]) => left.localeCompare(right));
  const lines = [
    '# Backend endpoint index',
    '',
    `Total: **${grouped.reduce((sum, [, routes]) => sum + routes.length, 0)} endpoints** across **${grouped.length} modules**.`,
    '',
    '| Module | Endpoints | Postman collection |',
    '| --- | ---: | --- |',
    ...grouped.map(([moduleName, routes]) => `| ${moduleName} | ${routes.length} | \`postman/${moduleName}.postman_collection.json\` |`),
    '',
    'Import `LNG_Web_BE_All.postman_collection.json` for the full catalog, or import one module collection for focused frontend work.',
    '',
  ];
  return lines.join('\n');
}

function main() {
  fs.writeFileSync(outputPath, `${JSON.stringify(buildAggregate(), null, 2)}\n`);
  fs.writeFileSync(indexPath, buildIndex());
}

if (require.main === module) main();
module.exports = { buildAggregate, buildIndex };
