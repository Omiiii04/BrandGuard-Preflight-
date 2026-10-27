/**
 * seed.js — BrandGuard Preflight Entrypoint Seed Script.
 * Runs the demo data seeder against MongoDB.
 */

'use strict';

require('dotenv').config();
const { seedDemoData } = require('./src/utils/seed');
const { connectDB } = require('./src/utils/db');
const mongoose = require('mongoose');

async function main() {
  try {
    console.log('[seed] Connecting to MongoDB…');
    await connectDB();
    await seedDemoData({ force: process.argv.includes('--force') });
    await mongoose.disconnect();
    console.log('[seed] Seeding process complete.');
    process.exit(0);
  } catch (err) {
    console.error('[seed] Seeding failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { seedDemoData };
