// Unit tests never touch real infrastructure; provide deterministic configuration.
process.env.APP_ENV = 'test';
process.env.DATABASE_URL ??= 'mongodb://localhost:27017/unit_test';
process.env.JWT_ACCESS_SECRET ??= 'unit-test-secret-that-is-at-least-32-characters';
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.FILE_URL_SIGNING_SECRET ??= 'unit-test-file-signing-secret';
process.env.REDIS_URL = '';
