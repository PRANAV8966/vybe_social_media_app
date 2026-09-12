const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let replSet;

/** Transactions require a replica set — a plain standalone mongod can't run them. */
async function connect() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  // mongoose builds indexes in the background by default — without waiting
  // for them, uniqueness/partial-index tests can run before the index
  // actually exists and pass for the wrong reason (or fail spuriously).
  await mongoose.connection.syncIndexes();
}

async function closeDatabase() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
}

async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

module.exports = { connect, closeDatabase, clearDatabase };
