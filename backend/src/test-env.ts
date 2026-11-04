// Loaded by vitest before every test file. Never point tests at a real database.
import {assertSafeMongoUri} from './mongo-safety.js';

// Catch an inherited remote URI before isolating the test process from it.
assertSafeMongoUri(process.env.MONGODB_URI);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-test-secret-with-more-than-32-characters';
process.env.PERSISTENCE = 'json';
process.env.DATA_FILE = './data/test-store.json';
process.env.API_AUTOSTART = 'false';
delete process.env.MONGODB_URI;
