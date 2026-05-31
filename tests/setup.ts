// Vitest global setup: forces a sane test env BEFORE config validation runs.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-prod-1234';
process.env.DB_CLIENT = 'sqlite3';
process.env.DB_FILE = ':memory:';
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6379';
process.env.STORAGE_TYPE = 'local';
process.env.STORAGE_LOCAL_DIR = 'storage/uploads-test';
process.env.UPLOAD_MAX_BYTES = '5242880';
process.env.APP_URL = 'http://localhost:3000';
