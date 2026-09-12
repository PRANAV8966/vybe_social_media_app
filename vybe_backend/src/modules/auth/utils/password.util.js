const crypto = require('crypto');
const { argon2id, argon2Verify } = require('hash-wasm');

/**
 * argon2id — OWASP's current top recommendation over bcrypt (memory-hard,
 * resists GPU/ASIC cracking). Implemented via hash-wasm (pure WebAssembly)
 * rather than the native `argon2` binding so the project has no node-gyp /
 * Python build-toolchain requirement on any dev machine, CI runner, or
 * deploy target. Parameters match OWASP's current baseline recommendation.
 */
const ARGON2ID_PARAMS = {
  parallelism: 1,
  iterations: 2,
  memorySize: 19456, // KiB (19 MiB)
  hashLength: 32,
};

async function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(16);
  return argon2id({
    password: plainPassword,
    salt,
    outputType: 'encoded',
    ...ARGON2ID_PARAMS,
  });
}

function verifyPassword(hash, plainPassword) {
  return argon2Verify({ hash, password: plainPassword });
}

module.exports = { hashPassword, verifyPassword };
