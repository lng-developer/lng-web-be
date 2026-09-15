// Mongoose does not inherit parent immutability for dotted subdocument updates.
function immutableFields(schema) {
  schema.eachPath((name, path) => {
    path.options.immutable = true;
    path.immutable(true);
    if (path.schema) immutableFields(path.schema);
  });
  return schema;
}

module.exports = immutableFields;
