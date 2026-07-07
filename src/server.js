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
const allowedOrigin = config.frontendUrl;

const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
  },
});

app.use(helmet());
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

const limiter = rateLimit({
  windowMs: config.rateLimits.default.windowMs,
  max: config.rateLimits.default.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
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
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/game', authMiddleware, gameRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/nft', authMiddleware, nftRoutes);

socketService.initialize(io);

app.use(errorHandler);

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

async function startServer() {
  try {
    getFirestore();
    await initialize();

    server.listen(config.port, () => {
      console.log(`FishBase backend running on port ${config.port}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

startServer();
