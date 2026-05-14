const jwt = require('jsonwebtoken');
const config = require('../config');
const { logger } = require('../utils/logger');
const { getFirestore } = require('../services/firebase');
const { calculateLevel } = require('../utils/gameLogic');

async function fetchUserSummary(userId) {
  if (!userId) return null;

  const db = getFirestore();
  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) {
    return null;
  }

  const data = userSnap.data();
  if (data?.isActive === false) {
    return null;
  }

  return {
    id: userSnap.id,
    fid: data.farcasterFid || null,
    username: data.username,
    walletAddress: data.walletAddress,
    totalXp: data.totalXp || 0,
    level: calculateLevel(data.totalXp || 0),
  };
}

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwt.secret);

    const userSummary = await fetchUserSummary(decoded.userId);
    if (!userSummary) {
      return res.status(401).json({
        error: 'Invalid token. User not found or inactive.'
      });
    }

    req.user = userSummary;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired.' });
    }

    logger.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed.' });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwt.secret);

    req.user = await fetchUserSummary(decoded.userId);
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

module.exports = {
  authMiddleware,
  optionalAuth,
};