const { Pool } = require('pg');
const config = require('../config/config');

const pool = new Pool({
  host: config.DATABASE.HOST,
  port: config.DATABASE.PORT,
  database: config.DATABASE.NAME,
  user: config.DATABASE.USER,
  password: config.DATABASE.PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

module.exports = pool;

