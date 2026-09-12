const mongoose = require('mongoose');
const env = require('./env');
const logger = require('./logger');

mongoose.set('strictQuery', true);

async function connectDB(uri = env.mongoUri) {
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'MongoDB connection error');
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  await mongoose.connect(uri);
  await assertReplicaSet();
  logger.info('MongoDB connected');
  return mongoose.connection;
}

/**
 * Every write path that touches more than one document (register, post
 * create/delete, refresh-token rotation) runs inside a transaction, which
 * MongoDB only supports on a replica set (or mongos). Failing fast here with
 * a clear message beats every one of those code paths mysteriously
 * 500-ing the first time someone hits them against a standalone mongod.
 */
async function assertReplicaSet() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error(
      'MONGO_URI must point at a replica set (or mongos) — this app relies on multi-document ' +
        'transactions. Local dev: run `mongod --replSet rs0` and `rs.initiate()` once. Atlas: this is the default.',
    );
  }
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB, mongoose };
