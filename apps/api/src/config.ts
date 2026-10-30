import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const envSchema=z.object({
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  PORT:z.coerce.number().int().positive().default(4000),
  APP_ORIGIN:z.string().url().default('http://localhost:5173'),
  JWT_SECRET:z.string().min(32,'JWT_SECRET must be at least 32 characters'),
  PERSISTENCE:z.enum(['mongo','json']).default('mongo'),
  MONGODB_URI:z.string().min(1).optional(),
  DATA_FILE:z.string().default('./data/store.json'),
  BUSINESS_TIMEZONE:z.string().default('Asia/Kolkata')
});
const parsed=envSchema.safeParse(process.env);
if(!parsed.success)throw new Error(`Invalid environment configuration: ${parsed.error.issues.map(i=>i.message).join('; ')}`);
export const config={...parsed.data,dataFile:path.resolve(parsed.data.DATA_FILE)};
if(config.PERSISTENCE==='mongo'&&!config.MONGODB_URI)throw new Error('MONGODB_URI is required when PERSISTENCE=mongo');
if(config.NODE_ENV==='production'){
  if(config.PERSISTENCE!=='mongo')throw new Error('Production requires PERSISTENCE=mongo; the JSON repository is development-only');
  if(/replace-with|change-me|changeme|demo|development/i.test(config.JWT_SECRET))throw new Error('Production JWT_SECRET must be a unique secret and must not contain placeholder or demo text');
}
