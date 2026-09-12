const { connect, closeDatabase, clearDatabase } = require('./db');

beforeAll(async () => {
  await connect();
}, 60000);

afterEach(async () => {
  await clearDatabase();
}, 60000);

afterAll(async () => {
  await closeDatabase();
}, 60000);
