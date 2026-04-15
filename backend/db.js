require('dotenv').config();
const { Pool } = require('pg');
const pgvector = require('pgvector/pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:ats@localhost:5432/ats',
});

// We use toVec/fromVec defensively in server.js, so we bypass registering pgvector
// types on the pool natively. This fixes the overlapping query warnings and crash
// before migration runs.

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

/**
 * Helper: run a query on the pool.
 * Usage: db.query(sql, [params])
 */
const db = {
  query: (text, params) => pool.query(text, params),
  pool,
  /**
   * Run a callback inside a transaction.
   * The callback receives a client; caller must use client.query() inside.
   */
  transaction: async (callback) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

module.exports = db;
