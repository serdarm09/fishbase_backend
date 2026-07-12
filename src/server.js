const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const leaderboardRoutes = require('./routes/leaderboard');
const nftRoutes = require('./routes/nft');
const { authMiddleware } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { getFirestore } = require('./services/firebase');
const { initialize } = require('./services/blockchain');
const socketService = require('./services/socket');
const config = require('./config');

const app = express();
const server = createServer(app);
const isVercel = Boolean(process.env.VERCEL);
let initPromise = null;
const allowedOrigins = Array.from(
  new Set(
    [config.frontendUrl, config.app.url]
      .filter(Boolean)
      .flatMap((value) =>
        String(value)
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      )
      .flatMap((origin) => {
        try {
          const url = new URL(origin);
          if (url.hostname === 'localhost') {
            url.hostname = '127.0.0.1';
            return [origin, url.toString().replace(/\/$/, '')];
          }
          if (url.hostname === '127.0.0.1') {
            url.hostname = 'localhost';
            return [origin, url.toString().replace(/\/$/, '')];
          }
        } catch (_error) {
          return [origin];
        }

        return [origin];
      })
  )
);

function corsOrigin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`CORS origin not allowed: ${origin}`));
}

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      getFirestore();
      await initialize();

      if (!isVercel) {
        socketService.initialize(io);
      }
    })();
  }

  return initPromise;
}

app.use(helmet());
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);

const limiter = rateLimit({
  windowMs: config.rateLimits.default.windowMs,
  max: config.rateLimits.default.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !config.rateLimits.enabled || req.method === 'OPTIONS',
  message: { error: 'Too many requests from this IP' },
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    runtime: isVercel ? 'vercel' : 'node',
  });
});

app.use(async (req, res, next) => {
  try {
    await ensureInitialized();
    next();
  } catch (error) {
    next(error);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/game', authMiddleware, gameRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/nft', authMiddleware, nftRoutes);

app.use(errorHandler);

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

async function startServer() {
  try {
    await ensureInitialized();

    server.listen(config.port, () => {
      console.log(`FishBase backend running on port ${config.port}`);
      console.log(`Environment: ${config.nodeEnv}`);
      console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

if (!isVercel) {
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
      console.log('Process terminated');
    });
  });

  startServer();
}

module.exports = app;
