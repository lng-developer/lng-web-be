const { toId } = require('./dto.helpers');

function toProductTypeGroupDto(group) {
  if (!group) return null;

  return {
    id: toId(group._id || group.id),
    code: group.code,
    name: group.name,
    sortOrder: group.sortOrder || 0,
    printMethod: group.printMethod || null,
    status: group.status,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

module.exports = {
  toProductTypeGroupDto,
};
