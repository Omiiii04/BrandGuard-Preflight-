/**
 * db.js — Mongoose connection singleton.
 *
 * Call `connectDB()` once at server startup.
 * All Mongoose models share this connection automatically.
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:27017/brandguard';

// Connection-state cache so hot-reloads (nodemon) don't open duplicate connections.
let _connected = false;

/**
 * Opens the Mongoose connection if not already open.
 * @returns {Promise<void>}
 */
async function connectDB() {
  if (_connected) return;

  mongoose.set('strictQuery', true); // suppress deprecation warning in Mongoose 7+

  mongoose.connection.on('connected', () => {
    console.log('[DB] MongoDB connected:', MONGODB_URI.replace(/:\/\/.*@/, '://***@'));
  });

  mongoose.connection.on('error', (err) => {
    console.error('[DB] MongoDB connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[DB] MongoDB disconnected. Will retry automatically.');
    _connected = false;
  });

  await mongoose.connect(MONGODB_URI, {
    // These options are the recommended defaults for Mongoose 8.x
    serverSelectionTimeoutMS: 5000,  // fail fast during startup
    socketTimeoutMS: 45_000,
    maxPoolSize: 10,
  });

  _connected = true;
}

/**
 * Gracefully closes the connection (used in tests / shutdown hooks).
 */
async function disconnectDB() {
  if (!_connected) return;
  await mongoose.connection.close();
  _connected = false;
  console.log('[DB] MongoDB connection closed.');
}

module.exports = { connectDB, disconnectDB };
