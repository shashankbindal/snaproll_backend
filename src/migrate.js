import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
await pool.query(await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
await pool.end();
console.log('SnapRoll database schema is ready.');
