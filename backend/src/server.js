/**
 * server.js — BrandGuard Preflight API entry point.
 *
 * Start order:
 *   1. Load environment variables (.env)
 *   2. Connect to MongoDB
 *   3. Ensure MinIO bucket exists
 *   4. Mount Express middleware & routes
 *   5. Begin listening
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');

const { connectDB }   = require('./utils/db');
const { ensureBucket } = require('./utils/minio');

// ── Express app ──────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || process.env.API_PORT || 4000;

// ── Global middleware ────────────────────────────────────────────────────────
const corsOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : '*';

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: process.env.UPLOAD_MAX_BYTES ? `${process.env.UPLOAD_MAX_BYTES}b` : '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ───────────────────────────────────────────────────────────────────
// Healthcheck — intentionally before any auth middleware so load-balancers
// and Docker Compose health probes can reach it unauthenticated.
app.get('/health', (_req, res) => {
  res.status(200).json({
    status:    'healthy',
    service:   'brandguard-api',
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.json({ name: 'BrandGuard Preflight API', version: '1.0.0', status: 'running' });
});

// ── Feature routes ──────────────────────────────────────────────────────────
const sourcesRouter = require('./routes/sources');
app.use('/v1/sources', sourcesRouter);

const draftsRouter = require('./routes/drafts');
app.use('/v1/drafts', draftsRouter);

const findingsRouter = require('./routes/findings');
app.use('/v1/findings', findingsRouter);

const factsRouter = require('./routes/facts');
app.use('/v1/facts', factsRouter);

const passportsRouter = require('./routes/passports');
app.use('/v1/passports', passportsRouter);

// ── Error handling middleware ────────────────────────────────────────────────
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
app.use(notFoundHandler);
app.use(errorHandler);


// ── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  try {
    console.log('[server] Connecting to MongoDB…');
    await connectDB();

    try {
      console.log('[server] Bootstrapping MinIO bucket…');
      await ensureBucket();
    } catch (minioErr) {
      console.warn('[server] MinIO unreachable (file storage offline):', minioErr.message);
    }

    // Start background shelf-life warning scheduler
    const { startShelfLifeScheduler } = require('./services/shelfLifeScheduler');
    if (process.env.NODE_ENV !== 'test') {
      startShelfLifeScheduler();
    }


    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[server] BrandGuard API listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    });
  } catch (err) {
    console.error('[server] Fatal startup error:', err.message);
    process.exit(1);
  }
}

start();
