import os from 'node:os';
import path from 'node:path';
import { loadEnvFile } from '../src/config/env';

// Runs in every integration test worker BEFORE application modules are imported.
loadEnvFile();
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL must be set for integration tests');
process.env.DATABASE_URL = testUrl;
process.env.APP_ENV = 'test';
process.env.REDIS_URL = '';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = path.join(os.tmpdir(), 'estate-test-storage');
process.env.SMTP_HOST = '';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.WHATSAPP_CLOUD_TOKEN = '';
process.env.TURNSTILE_SECRET_KEY = '';
