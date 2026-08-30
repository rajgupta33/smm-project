require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { connectToDatabase, disconnectFromDatabase } = require('./utils/serverlessDb');
const { authenticate, getJwtSecret, requireAdmin } = require('./middelwares/auth');
const { getRuntimeConfig } = require('./config/runtimeConfig');
const { csrfProtection } = require('./middelwares/csrf');
const {
  closeProducerQueues, getRedisReadiness, getWorkerHeartbeat,
} = require('./queues/queueRegistry');

function createApp({ connect = connectToDatabase } = {}) {
  getJwtSecret();
  const runtimeConfig = getRuntimeConfig();

  const app = express();
  app.locals.runtimeConfig = runtimeConfig;
  app.set('trust proxy', runtimeConfig.trustProxy);

  // Liveness: the process is up and configuration loaded. No dependency
  // checks here, so an orchestrator never restarts a healthy process just
  // because Mongo or Redis is briefly unreachable.
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Readiness: safe to receive traffic. Checked separately from liveness so
  // a database or Redis outage takes the instance out of rotation without
  // triggering restarts.
  app.get('/ready', async (req, res) => {
    const { getConnectionStatus } = require('./utils/serverlessDb');
    const checks = {
      mongo: false,
      redis: { connected: false, maxmemoryPolicy: null, noEviction: false },
      worker: { healthy: false, lastHeartbeatAt: null, ageMs: null },
    };
    try {
      await connect();
      checks.mongo = getConnectionStatus().readyState === 1;
    } catch (error) {
      console.error('Readiness check: database unreachable:', error.message);
    }
    try {
      checks.redis = await getRedisReadiness();
      if (checks.redis.connected) {
        const worker = await getWorkerHeartbeat();
        checks.worker = {
          healthy: worker.healthy,
          lastHeartbeatAt: worker.lastHeartbeatAt,
          ageMs: worker.ageMs,
        };
      }
    } catch (error) {
      console.error('Readiness check: Redis unreachable:', error.message);
    }
    const ready = checks.mongo && checks.redis.connected && checks.redis.noEviction && checks.worker.healthy;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
  });

  app.use(cors({
    origin(origin, callback) {
      if (!origin || runtimeConfig.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'Cache-Control',
      'X-CSRF-Token',
      'Idempotency-Key',
      'X-Request-Id'
    ],
    exposedHeaders: ['Set-Cookie'],
    optionsSuccessStatus: 200
  }));

  app.use(cookieParser());

  app.use(async (req, res, next) => {
    try {
      await connect();
      next();
    } catch (error) {
      console.error('Database connection failed:', error);
      res.status(500).json({ error: 'Database connection failed' });
    }
  });

  // Cashfree signatures cover the exact request bytes, so this route must run
  // before any JSON body parser. Authentication is the verified HMAC signature.
  const paymentController = require('./controllers/paymentController');
  app.post(
    '/api/webhooks/cashfree',
    express.raw({ type: 'application/json', limit: '1mb' }),
    paymentController.cashfreeWebhook
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.get('/api/check', (req, res) => {
    try {
      const { getConnectionStatus } = require('./utils/serverlessDb');
      res.status(200).json({
        msg: 'all good',
        timestamp: new Date().toISOString(),
        database: getConnectionStatus()
      });
    } catch (error) {
      res.status(500).json({
        msg: 'health check failed',
        error: error.message
      });
    }
  });

  const adminRoutes = require('./routes/adminRoutes');
  app.use('/api/admin', authenticate, requireAdmin, csrfProtection, adminRoutes);

  const userRoutes = require('./routes/userRoutes');
  app.use('/api/user', authenticate, csrfProtection, userRoutes);

  const paymentRoutes = require('./routes/paymentRoutes');
  app.use('/api/payments', authenticate, csrfProtection, paymentRoutes);

  const authRoutes = require('./routes/authRoutes');
  app.use('/api/auth', authRoutes);

  app.use((error, req, res, next) => {
    void req;
    void next;
    console.error(error.stack);
    res.status(500).json({ error: 'Something went wrong!' });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  return app;
}

process.on('SIGINT', async () => {
  console.log('Received SIGINT. Performing graceful shutdown...');
  await closeProducerQueues();
  await disconnectFromDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM. Performing graceful shutdown...');
  await closeProducerQueues();
  await disconnectFromDatabase();
  process.exit(0);
});

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;
