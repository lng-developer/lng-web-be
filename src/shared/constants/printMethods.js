const printMethods = Object.freeze({
  DTG: 'DTG',
  DTF: 'DTF',
  SUBLIMATION: 'SUBLIMATION',
  EMBROIDERY: 'EMBROIDERY',
  OTHER: 'OTHER',
});

const printMethodValues = Object.freeze(Object.values(printMethods));

module.exports = {
  printMethods,
  printMethodValues,
};
