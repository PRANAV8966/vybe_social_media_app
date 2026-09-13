const crypto = require('crypto');

/** Deterministic, order-independent identity for a direct conversation between two users. */
function buildCanonicalKey(userIdA, userIdB) {
  const sorted = [String(userIdA), String(userIdB)].sort();
  return crypto.createHash('sha256').update(sorted.join(':')).digest('hex');
}

module.exports = { buildCanonicalKey };
