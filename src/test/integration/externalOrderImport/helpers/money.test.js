const { parseMoneyToMinorUnit } = require('../../../../modules/integration/externalOrderImport/helpers/money');

describe('parseMoneyToMinorUnit', () => {
  test.each([
    ['35.3', 3530],
    ['35.30', 3530],
    ['2.77', 277],
    ['0.49', 49],
    ['-1.77', -177],
    ['', 0],
    [null, 0],
    [undefined, 0],
  ])('maps %p to %p', (input, expected) => {
    expect(parseMoneyToMinorUnit(input)).toBe(expected);
  });
});
