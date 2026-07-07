function integerAmountField({ defaultValue = 0, min } = {}) {
  return {
    type: Number,
    default: defaultValue,
    min,
    validate: {
      validator: Number.isInteger,
      message: '{PATH} must be an integer minor unit value',
    },
  };
}

function optionalObjectIdRef(ref) {
  return {
    type: require('mongoose').Schema.Types.ObjectId,
    ref,
    default: null,
    index: true,
  };
}

module.exports = {
  integerAmountField,
  optionalObjectIdRef,
};
