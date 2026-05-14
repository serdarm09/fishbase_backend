const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { randomBytes } = require('crypto');
const { ethers } = require('ethers');
const { body, validationResult } = require('express-validator');
const config = require('../config');
const { verifyFarcasterSignature, isValidFid } = require('../services/farcaster');
const { logger } = require('../utils/logger');
const { getFirestore } = require('../services/firebase');
const { getBoostInfo } = require('../services/boost');
const { calculateLevel, xpToNextLevel, canClaimDaily } = require('../utils/gameLogic');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: config.rateLimits.auth.windowMs,
  max: config.rateLimits.auth.max,
  message: { error: 'Too many authentication attempts' },
});

function buildUserPayload(id, data) {
  const totalXp = data.totalXp || 0;
  return {
    id,
    fid: data.farcasterFid,
    username: data.username,
    walletAddress: data.walletAddress,
    totalXp,
    totalFish: data.totalFish || 0,
    currentStreak: data.currentStreak || 0,
    longestStreak: data.longestStreak || 0,
    level: calculateLevel(totalXp),
    xpToNextLevel: xpToNextLevel(totalXp),
    profileData: data.profileData || {},
    mapPosition: data.mapPosition || null,
    activeBoat: data.activeBoat || null,
    boats: data.boats || [],
    achievements: data.achievements || [],
    miniGame: data.miniGame || {},
    canClaimDaily: canClaimDaily(data),
    boost: data.boost || { level: 'NONE', multiplier: 0, name: 'No Boost' },
    lastClaimDate: data.lastClaimDate || null,
  };
}

async function findUserByFid(db, fid) {
  const snapshot = await db
    .collection('users')
    .where('farcasterFid', '==', fid)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  return { id: doc.id, data: doc.data() };
}

async function findUserByWallet(db, walletAddress) {
  const snapshot = await db
    .collection('users')
    .where('walletAddress', '==', walletAddress.toLowerCase())
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  return { id: doc.id, data: doc.data() };
}

function buildWalletUsername(walletAddress) {
  return `captain_${walletAddress.slice(2, 8)}`;
}

function createBaseUserData({ walletAddress, username, farcasterFid = null, profileData = {}, boostInfo, now }) {
  return {
    farcasterFid,
    username,
    walletAddress,
    totalXp: 0,
    totalFish: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastClaimDate: null,
    mapPosition: { x: null, y: null, lastMoved: null },
    achievements: [],
    profileData: {
      pfpUrl: '',
      avatar: '',
      displayName: '',
      bio: '',
      ...profileData,
    },
    miniGame: {
      highScore: 0,
      bestReactionMs: null,
      totalGames: 0,
      totalScore: 0,
      lastScore: 0,
      lastPlayedAt: null,
    },
    boats: [],
    activeBoat: null,
    boost: boostInfo,
    authMethods: farcasterFid ? ['farcaster'] : ['wallet'],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

function signSession(userRef, data) {
  return jwt.sign(
    {
      userId: userRef.id,
      fid: data.farcasterFid || null,
      walletAddress: data.walletAddress,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function buildWalletChallengeMessage({
  walletAddress,
  nonce,
  issuedAt,
  expiresAt,
  domain,
  uri,
  chainId,
}) {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    walletAddress,
    '',
    'Sign in to FishBase. This request will not trigger a blockchain transaction or cost gas.',
    '',
    `URI: ${uri}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
  ].join('\n');
}

router.post(
  '/wallet-challenge',
  authLimiter,
  [
    body('walletAddress').isEthereumAddress().withMessage('Invalid wallet address'),
    body('domain').optional().isString().trim().isLength({ min: 1, max: 255 }),
    body('uri').optional().isURL({ require_tld: false }).withMessage('Invalid sign-in URI'),
    body('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain id'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const walletAddress = ethers.getAddress(req.body.walletAddress).toLowerCase();
      const nonce = randomBytes(16).toString('hex');
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const appUrl = new URL(config.app.url);
      const domain = req.body.domain || appUrl.host;
      const uri = req.body.uri || config.app.url;
      const chainId = Number(req.body.chainId || config.blockchain.chainId);
      const message = buildWalletChallengeMessage({
        walletAddress,
        nonce,
        issuedAt,
        expiresAt,
        domain,
        uri,
        chainId,
      });

      const db = getFirestore();
      await db.collection('authChallenges').doc(nonce).set({
        walletAddress,
        message,
        domain,
        uri,
        chainId,
        issuedAt,
        expiresAt,
        used: false,
      });

      res.json({ success: true, nonce, message, expiresAt });
    } catch (error) {
      logger.error('Wallet challenge error', { error: error.message });
      res.status(500).json({ error: 'Failed to create wallet challenge' });
    }
  }
);

router.post(
  '/wallet',
  authLimiter,
  [
    body('walletAddress').isEthereumAddress().withMessage('Invalid wallet address'),
    body('message').notEmpty().withMessage('Message is required'),
    body('signature').notEmpty().withMessage('Signature is required'),
    body('nonce').notEmpty().withMessage('Nonce is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const walletAddress = ethers.getAddress(req.body.walletAddress).toLowerCase();
      const { message, signature, nonce } = req.body;
      const db = getFirestore();
      const challengeRef = db.collection('authChallenges').doc(nonce);
      const challengeSnap = await challengeRef.get();

      if (!challengeSnap.exists) {
        return res.status(401).json({ error: 'Invalid wallet challenge' });
      }

      const challenge = challengeSnap.data();
      if (
        challenge.used ||
        challenge.walletAddress !== walletAddress ||
        challenge.message !== message ||
        Date.now() > new Date(challenge.expiresAt).getTime()
      ) {
        return res.status(401).json({ error: 'Expired or invalid wallet challenge' });
      }

      const recoveredAddress = ethers.verifyMessage(message, signature).toLowerCase();
      if (recoveredAddress !== walletAddress) {
        return res.status(401).json({ error: 'Invalid wallet signature' });
      }

      await challengeRef.update({ used: true, usedAt: new Date().toISOString() });

      const boostInfo = await getBoostInfo(walletAddress);
      const now = new Date().toISOString();
      let userRecord = await findUserByWallet(db, walletAddress);
      let userRef;
      let userData;

      if (!userRecord) {
        userRef = db.collection('users').doc();
        userData = createBaseUserData({
          walletAddress,
          username: buildWalletUsername(walletAddress),
          boostInfo,
          now,
        });

        await userRef.set(userData);
        logger.info('New wallet user registered', { walletAddress });
      } else {
        userRef = db.collection('users').doc(userRecord.id);
        userData = userRecord.data;
        const authMethods = Array.from(new Set([...(userData.authMethods || []), 'wallet']));
        const updates = {
          walletAddress,
          boost: boostInfo,
          authMethods,
          lastLoginAt: now,
          updatedAt: now,
        };

        await userRef.update(updates);
        Object.assign(userData, updates);
        logger.info('Wallet user logged in', { walletAddress });
      }

      const freshDoc = await userRef.get();
      const freshData = freshDoc.data();
      const token = signSession(userRef, freshData);

      res.json({
        success: true,
        token,
        user: buildUserPayload(userRef.id, freshData),
      });
    } catch (error) {
      logger.error('Wallet auth error', { error: error.message, stack: error.stack });
      res.status(500).json({ error: 'Wallet authentication failed' });
    }
  }
);

router.post(
  '/farcaster',
  authLimiter,
  [
    body('message').notEmpty().withMessage('Message is required'),
    body('signature').notEmpty().withMessage('Signature is required'),
    body('fid').optional().isNumeric().withMessage('FID must be a number'),
    body('nonce').optional().isString(),
    body('username').optional().isString(),
    body('custody_address').optional().isEthereumAddress().withMessage('Invalid custody address'),
    body('pfp_url').optional().isString(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array(),
        });
      }

      const { message, signature, nonce, fid, username, custody_address, pfp_url } = req.body;

      const verification = await verifyFarcasterSignature({
        message,
        signature,
        nonce,
        fid: fid ? parseInt(fid, 10) : undefined,
      });

      if (!verification) {
        logger.warn('Invalid Farcaster signature attempt', { fid, username });
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const resolvedFid = verification.fid ?? parseInt(fid, 10);
      if (!isValidFid(resolvedFid)) {
        logger.warn('Invalid FID during authentication', { fid: resolvedFid });
        return res.status(400).json({ error: 'Invalid Farcaster identity' });
      }

      const resolvedUsername = verification.username || username || `captain_${resolvedFid}`;
      const resolvedCustodyAddress = (verification.custodyAddress || custody_address || '').toLowerCase();
      const resolvedPfpUrl = verification.pfpUrl || pfp_url || '';
      const resolvedDisplayName = verification.displayName || '';

      if (!resolvedCustodyAddress) {
        logger.warn('Missing custody address after verification', { fid: resolvedFid });
        return res.status(400).json({ error: 'Custody address not found' });
      }

      const db = getFirestore();
      const boostInfo = await getBoostInfo(resolvedCustodyAddress);

      let userRecord = await findUserByFid(db, resolvedFid);
      if (!userRecord) {
        userRecord = await findUserByWallet(db, resolvedCustodyAddress);
      }
      let userRef;
      let userData;
      const now = new Date().toISOString();

      if (!userRecord) {
        userRef = db.collection('users').doc();
        userData = createBaseUserData({
          farcasterFid: resolvedFid,
          username: resolvedUsername,
          walletAddress: resolvedCustodyAddress,
          profileData: {
            pfpUrl: resolvedPfpUrl,
            avatar: resolvedPfpUrl,
            displayName: resolvedDisplayName,
          },
          boostInfo,
          now,
        });

        await userRef.set(userData);
        logger.info('New user registered', { fid: resolvedFid, username: resolvedUsername, custody: resolvedCustodyAddress });
      } else {
        userRef = db.collection('users').doc(userRecord.id);
        userData = userRecord.data;

        const authMethods = Array.from(new Set([...(userData.authMethods || []), 'farcaster']));
        const updates = {
          farcasterFid: resolvedFid,
          username: resolvedUsername || userData.username,
          walletAddress: resolvedCustodyAddress,
          profileData: {
            ...userData.profileData,
            pfpUrl: resolvedPfpUrl || userData.profileData?.pfpUrl || '',
            avatar: resolvedPfpUrl || userData.profileData?.avatar || '',
            displayName: resolvedDisplayName || userData.profileData?.displayName || '',
          },
          boost: boostInfo,
          authMethods,
          lastLoginAt: now,
          updatedAt: now,
        };

        await userRef.update(updates);
        Object.assign(userData, updates);
        logger.info('User logged in', { fid: resolvedFid, username: resolvedUsername });
      }

      const freshDoc = await userRef.get();
      const freshData = freshDoc.data();
      const token = signSession(userRef, freshData);
      const payload = buildUserPayload(userRef.id, freshData);

      res.json({
        success: true,
        token,
        user: payload,
      });
    } catch (error) {
      logger.error('Farcaster auth error', { error: error.message, stack: error.stack });
      res.status(500).json({ error: 'Authentication failed' });
    }
  }
);

router.post('/refresh', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, config.jwt.secret, { ignoreExpiration: true });
    const db = getFirestore();
    const userSnap = await db.collection('users').doc(decoded.userId).get();

    if (!userSnap.exists || userSnap.data()?.isActive === false) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const newToken = jwt.sign(
      {
        userId: userSnap.id,
        fid: userSnap.data().farcasterFid,
        walletAddress: userSnap.data().walletAddress,
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      success: true,
      token: newToken,
      user: buildUserPayload(userSnap.id, userSnap.data()),
    });
  } catch (error) {
    logger.error('Token refresh error', { error: error.message });
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwt.secret);
    const db = getFirestore();
    const userSnap = await db.collection('users').doc(decoded.userId).get();

    if (!userSnap.exists || userSnap.data()?.isActive === false) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: buildUserPayload(userSnap.id, userSnap.data()),
    });
  } catch (error) {
    logger.error('Get user info error', { error: error.message });
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
