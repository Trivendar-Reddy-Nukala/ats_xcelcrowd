require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const db   = require('../db');

async function migrate() {
  console.log('Running database migrations...');
  const sql = fs.readFileSync(path.join(__dirname, '001_init.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✅  Migration 001_init.sql applied successfully.');
  } catch (err) {
    // pg throws AggregateError on connection failures — .message is often empty
    const detail = err.message || (err.errors && err.errors.map(e => e.message).join(', ')) || String(err);
    console.error('❌  Migration failed:', detail);
    if (err.code === 'ECONNREFUSED') {
      console.error('   → PostgreSQL is not reachable. Is Docker running? Try: docker-compose up postgres -d');
    }
    console.error(err);
    process.exit(1);
  }
}

// If run directly: node migrations/migrate.js
if (require.main === module) {
  migrate().then(() => process.exit(0));
}

module.exports = migrate;
