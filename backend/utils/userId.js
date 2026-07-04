function normalizeUserId(userId) {
  return typeof userId === 'string' ? userId.trim().toLowerCase() : '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildUserIdQuery(userId) {
  const trimmed = typeof userId === 'string' ? userId.trim() : '';
  const normalized = normalizeUserId(trimmed);

  if (!normalized) {
    return null;
  }

  return {
    $or: [
      { userId: normalized },
      { userId: { $regex: `^${escapeRegExp(trimmed)}$`, $options: 'i' } },
    ],
  };
}

module.exports = {
  buildUserIdQuery,
  normalizeUserId,
};
