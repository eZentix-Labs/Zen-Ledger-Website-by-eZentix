// Loaded by vitest before every test file. Never point tests at a real database.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-test-secret-with-more-than-32-characters';
process.env.PERSISTENCE = 'json';
process.env.DATA_FILE = './data/test-store.json';
process.env.API_AUTOSTART = 'false';
delete process.env.MONGODB_URI;
