require('dotenv').config();

function normalizePrivateKey(value) {
  if (!value) {
    return value;
  }

  let normalized = value.trim();

  if (normalized.endsWith(',')) {
    normalized = normalized.slice(0, -1).trim();
  }

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }

  return normalized.replace(/\\n/g, '\n');
}

function envInt(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const rateLimitsEnabled =
  process.env.RATE_LIMIT_ENABLED !== undefined
    ? process.env.RATE_LIMIT_ENABLED !== 'false'
    : isProduction;

const config = {
  // Server
  port: process.env.PORT || 5000,
  nodeEnv,
  frontendUrl: process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000',
  app: {
    url: process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000',
    baseAppId: process.env.BASE_APP_ID || '6a01ca209ee68cd142d1b1ac',
  },

  // Blockchain
  blockchain: {
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    chainId: parseInt(process.env.BASE_CHAIN_ID || '8453'),
    privateKey: process.env.PRIVATE_KEY,
    contracts: {
      fishToken: process.env.FISH_TOKEN_ADDRESS || '',
      boatNFT: process.env.BOAT_NFT_ADDRESS || '',
      gameController: process.env.GAME_CONTROLLER_ADDRESS || '',
      boostNFT: process.env.BOOST_NFT_ADDRESS || '',
    },
  },

  // Firebase
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
  },

  // Farcaster
  farcaster: {
    clientId: process.env.FARCASTER_CLIENT_ID,
    clientSecret: process.env.FARCASTER_CLIENT_SECRET,
    appUrl: process.env.APP_URL || 'https://fishbase.app',
    relayUrl: process.env.FARCASTER_RELAY_URL || 'https://relay.farcaster.xyz',
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    expiresIn: '24h',
  },

  // Game Settings
  game: {
    gridSize: 100,
    placementFee: '0', // ETH; users only pay Base network gas by default
    referralXp: envInt('REFERRAL_XP_REWARD', 5),
    stagnantXpMultiplier: 0.1, // 10% reward if boat not moved in 24h
    movementBonusDays: 3,
    movementBonusMultiplier: 2.0, // 100% bonus
    streakMilestones: {
      7: { multiplier: 2.0, reward: 'badge_nft' },
      14: { multiplier: 3.0, reward: 'rare_badge' },
      30: { multiplier: 5.0, reward: 'legendary_skin' },
      100: { multiplier: 10.0, reward: 'custom_boat' },
    },
  },

  // Rate Limiting
  rateLimits: {
    enabled: rateLimitsEnabled,
    auth: {
      windowMs: envInt('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000),
      max: envInt('RATE_LIMIT_AUTH_MAX', isProduction ? 5 : 1000),
    },
    claimDaily: {
      windowMs: envInt('RATE_LIMIT_CLAIM_WINDOW_MS', 24 * 60 * 60 * 1000),
      max: envInt('RATE_LIMIT_CLAIM_MAX', isProduction ? 1 : 1000),
    },
    placeBoat: {
      windowMs: envInt('RATE_LIMIT_PLACE_BOAT_WINDOW_MS', 60 * 60 * 1000),
      max: envInt('RATE_LIMIT_PLACE_BOAT_MAX', isProduction ? 10 : 1000),
    },
    default: {
      windowMs: envInt('RATE_LIMIT_DEFAULT_WINDOW_MS', 15 * 60 * 1000),
      max: envInt('RATE_LIMIT_DEFAULT_MAX', isProduction ? 100 : 2000),
    },
  },

  boostLevels: [
    { id: 1, level: 'BOOST_20', name: 'Bronze Hook', multiplier: 0.2, priceEth: '0.001', image: '/boosts/boost-20.png' },
    { id: 2, level: 'BOOST_30', name: 'Silver Reel', multiplier: 0.3, priceEth: '0.0015', image: '/boosts/boost-30.png' },
    { id: 3, level: 'BOOST_40', name: 'Golden Net', multiplier: 0.4, priceEth: '0.002', image: '/boosts/boost-40.png' },
  ],
};

// Validation
const requiredEnvVars = [
  'JWT_SECRET',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'APP_URL',
];

if (config.nodeEnv === 'production') {
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }
}

module.exports = config;
