require('dotenv').config();

const config = {
  // Server
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
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
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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
    placementFee: '0.001', // ETH
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
    auth: { windowMs: 15 * 60 * 1000, max: 5 }, // 5 per 15min
    claimDaily: { windowMs: 24 * 60 * 60 * 1000, max: 1 }, // 1 per day
    placeBoat: { windowMs: 60 * 60 * 1000, max: 10 }, // 10 per hour
    default: { windowMs: 15 * 60 * 1000, max: 100 }, // 100 per 15min
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
