'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const config = require('../config');
const { logger } = require('../utils/logger');
const { getFirestore } = require('../services/firebase');
const { getBoostInfo } = require('../services/boost');
const { blockchainService } = require('../services/blockchain');
const {
  calculateLevel,
  xpToNextLevel,
  canClaimDaily,
  getStreakMultiplier,
  hasBoatMovedRecently,
  applyStagnationPenalty,
  isSeaCoordinate,
} = require('../utils/gameLogic');

const router = express.Router();

const claimLimiter = rateLimit({
  windowMs: config.rateLimits.claimDaily.windowMs,
  max: config.rateLimits.claimDaily.max,
  message: { error: 'Daily claim already used' },
  keyGenerator: (req) => `claim:${req.user?.id}`,
});

const placementLimiter = rateLimit({
  windowMs: config.rateLimits.placeBoat.windowMs,
  max: config.rateLimits.placeBoat.max,
  message: { error: 'Too many boat placements' },
});

function buildProfilePayload(id, data) {
  const totalXp = data.totalXp || 0;
  return {
    id,
    username: data.username,
    walletAddress: data.walletAddress,
    totalXp,
    totalFish: data.totalFish || 0,
    currentStreak: data.currentStreak || 0,
    longestStreak: data.longestStreak || 0,
    level: calculateLevel(totalXp),
    xpToNextLevel: xpToNextLevel(totalXp),
    mapPosition: data.mapPosition || null,
    canClaimDaily: canClaimDaily(data),
    profileData: data.profileData || {},
    achievements: data.achievements || [],
    activeBoat: data.activeBoat || null,
    boats: data.boats || [],
    miniGame: data.miniGame || {},
    boost: data.boost || { level: 'NONE', multiplier: 0 },
    lastClaimDate: data.lastClaimDate || null,
  };
}

async function getUserDocument(db, userId) {
  const userRef = db.collection('users').doc(userId);
  const snapshot = await userRef.get();
  if (!snapshot.exists) {
    return null;
  }
  return { ref: userRef, data: snapshot.data() };
}

function hasVerifiedActiveBoat(activeBoat) {
  return Boolean(activeBoat && activeBoat.dailyXp && activeBoat.verifiedAt);
}

async function verifyActiveBoatOwnership(activeBoat, walletAddress) {
  if (!hasVerifiedActiveBoat(activeBoat)) {
    return false;
  }

  try {
    await blockchainService.getBoatOwnershipDetails(activeBoat.tokenId, walletAddress);
    return true;
  } catch (error) {
    logger.warn('Active boat ownership verification failed', {
      tokenId: activeBoat.tokenId,
      walletAddress,
      error: error.message,
    });
    return false;
  }
}

router.get('/profile', async (req, res) => {
  try {
    const db = getFirestore();
    const userRecord = await getUserDocument(db, req.user.id);
    if (!userRecord) {
      return res.status(404).json({ error: 'User not found' });
    }

    const payload = buildProfilePayload(userRecord.ref.id, userRecord.data);
    res.json({ success: true, profile: payload });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

router.post('/claim-daily', claimLimiter, async (req, res) => {
  try {
    const db = getFirestore();
    const userRef = db.collection('users').doc(req.user.id);
    const boostInfo = await getBoostInfo(req.user.walletAddress);
    const nowIso = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(userRef);
      if (!snapshot.exists) {
        throw new Error('User not found');
      }

      const data = snapshot.data();
      const activeBoat = data.activeBoat;
      const ownsActiveBoat = await verifyActiveBoatOwnership(activeBoat, req.user.walletAddress);
      if (!ownsActiveBoat) {
        return { error: 'No verified active boat found' };
      }

      if (!canClaimDaily(data)) {
        const nextClaimTime = new Date(new Date(data.lastClaimDate).getTime() + 24 * 60 * 60 * 1000);
        return {
          error: 'Cannot claim yet',
          nextClaimTime,
        };
      }

      const lastClaim = data.lastClaimDate ? new Date(data.lastClaimDate).getTime() : null;
      let newStreak = 1;
      if (lastClaim) {
        const hoursSinceLastClaim = (Date.now() - lastClaim) / (1000 * 60 * 60);
        newStreak = hoursSinceLastClaim <= 48 ? (data.currentStreak || 0) + 1 : 1;
      }

      const streakMultiplier = getStreakMultiplier(newStreak);
      const boostMultiplier = boostInfo.multiplier || data.boost?.multiplier || 0;

      let baseXp = Math.round((activeBoat.dailyXp || 0) * (1 + boostMultiplier));
      if (!hasBoatMovedRecently(activeBoat.lastMoved)) {
        baseXp = applyStagnationPenalty(baseXp);
      }

      const finalXp = Math.max(0, Math.round(baseXp * streakMultiplier));

      const boats = data.boats || [];
      const activeBoatEntry =
        boats.find((boat) => boat.tokenId === activeBoat.tokenId) || activeBoat;
      const existingStats = activeBoatEntry?.stats || {};
      const boatStats = {
        totalXpEarned: (existingStats.totalXpEarned || 0) + finalXp,
        daysActive: (existingStats.daysActive || 0) + 1,
        timesMoved: existingStats.timesMoved || 0,
      };

      const updatedBoats = boats.map((boat) =>
        boat.tokenId === activeBoat.tokenId
          ? {
              ...boat,
              stats: boatStats,
            }
          : boat
      );

      const updatedData = {
        totalXp: (data.totalXp || 0) + finalXp,
        totalFish: (data.totalFish || 0) + finalXp,
        currentStreak: newStreak,
        longestStreak: Math.max(data.longestStreak || 0, newStreak),
        lastClaimDate: nowIso,
        updatedAt: nowIso,
        boost: boostInfo,
        boats: updatedBoats,
        activeBoat: {
          ...activeBoat,
          stats: boatStats,
        },
      };

      tx.update(userRef, updatedData);

      return {
        xpEarned: finalXp,
        newStreak,
        totalXp: updatedData.totalXp,
        streakMultiplier,
        nextClaimTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    });

    if (result?.error) {
      return res.status(400).json({ error: result.error, nextClaimTime: result.nextClaimTime });
    }

    res.json({
      success: true,
      claim: {
        xpEarned: result.xpEarned,
        newStreak: result.newStreak,
        totalXp: result.totalXp,
        streakMultiplier: result.streakMultiplier,
        nextClaimTime: result.nextClaimTime,
      },
    });
  } catch (error) {
    logger.error('Daily claim error:', error);
    res.status(500).json({ error: 'Failed to claim daily reward' });
  }
});

router.post(
  '/place-boat',
  placementLimiter,
  [
    body('x').isInt({ min: 0, max: config.game.gridSize - 1 }).withMessage('X must be between 0-99'),
    body('y').isInt({ min: 0, max: config.game.gridSize - 1 }).withMessage('Y must be between 0-99'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Invalid coordinates', details: errors.array() });
      }

      const db = getFirestore();
      const { x, y } = req.body;
      if (!isSeaCoordinate(x, y, config.game.gridSize)) {
        return res.status(400).json({ error: 'Boats can only be placed on open sea' });
      }

      const cellId = `${x}_${y}`;
      const cellRef = db.collection('mapPlacements').doc(cellId);
      const userRef = db.collection('users').doc(req.user.id);
      const nowIso = new Date().toISOString();

      const result = await db.runTransaction(async (tx) => {
        const [userSnap, cellSnap] = await Promise.all([tx.get(userRef), tx.get(cellRef)]);

        if (!userSnap.exists) {
          throw new Error('User not found');
        }

        if (cellSnap.exists) {
          return { error: 'Position already occupied' };
        }

        const data = userSnap.data();
        const activeBoat = data.activeBoat;
        const ownsActiveBoat = await verifyActiveBoatOwnership(activeBoat, req.user.walletAddress);
        if (!ownsActiveBoat) {
          return { error: 'No verified active boat found' };
        }

        const boats = data.boats || [];

        if (activeBoat.mapX !== null && activeBoat.mapY !== null) {
          const previousCell = db.collection('mapPlacements').doc(`${activeBoat.mapX}_${activeBoat.mapY}`);
          tx.delete(previousCell);
        }

        const updatedActiveBoat = {
          ...activeBoat,
          mapX: x,
          mapY: y,
          lastMoved: nowIso,
        };

        const updatedBoats = boats.map((boat) => {
          if (boat.tokenId === activeBoat.tokenId) {
            const stats = {
              totalXpEarned: boat.stats?.totalXpEarned || 0,
              daysActive: boat.stats?.daysActive || 0,
              timesMoved: (boat.stats?.timesMoved || 0) + 1,
            };
            return {
              ...boat,
              isActive: true,
              position: { x, y, lastMoved: nowIso },
              stats,
            };
          }
          return boat;
        });

        tx.set(cellRef, {
          userId: req.user.id,
          ownerUsername: data.username,
          boostLevel: (data.boost?.level) || 'NONE',
          boostImage: data.boost?.image || null,
          boatType: activeBoat.boatType || 'DINGHY',
          xp: activeBoat.dailyXp || 0,
          createdAt: nowIso,
        });

        tx.update(userRef, {
          activeBoat: updatedActiveBoat,
          boats: updatedBoats,
          mapPosition: { x, y, lastMoved: nowIso },
          updatedAt: nowIso,
        });

        return {
          x,
          y,
          boatType: activeBoat.boatType || 'DINGHY',
          placedAt: nowIso,
        };
      });

      if (result?.error) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true, placement: result });
    } catch (error) {
      logger.error('Place boat error:', error);
      res.status(500).json({ error: 'Failed to place boat' });
    }
  }
);

router.post(
  '/move-boat',
  placementLimiter,
  [
    body('x').isInt({ min: 0, max: config.game.gridSize - 1 }).withMessage('X must be between 0-99'),
    body('y').isInt({ min: 0, max: config.game.gridSize - 1 }).withMessage('Y must be between 0-99'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Invalid coordinates', details: errors.array() });
      }

      const db = getFirestore();
      const { x, y } = req.body;
      if (!isSeaCoordinate(x, y, config.game.gridSize)) {
        return res.status(400).json({ error: 'Boats can only be moved to open sea' });
      }

      const newCellId = `${x}_${y}`;
      const newCellRef = db.collection('mapPlacements').doc(newCellId);
      const userRef = db.collection('users').doc(req.user.id);
      const nowIso = new Date().toISOString();

      const result = await db.runTransaction(async (tx) => {
        const [userSnap, newCellSnap] = await Promise.all([tx.get(userRef), tx.get(newCellRef)]);

        if (!userSnap.exists) {
          throw new Error('User not found');
        }

        const data = userSnap.data();
        const activeBoat = data.activeBoat;
        const ownsActiveBoat = await verifyActiveBoatOwnership(activeBoat, req.user.walletAddress);
        if (!ownsActiveBoat || activeBoat.mapX === null || activeBoat.mapY === null) {
          return { error: 'No verified boat placed on map' };
        }

        if (newCellSnap.exists && newCellSnap.data().userId !== req.user.id) {
          return { error: 'Position already occupied' };
        }

        const previousCell = db.collection('mapPlacements').doc(`${activeBoat.mapX}_${activeBoat.mapY}`);
        tx.delete(previousCell);

        const updatedActiveBoat = {
          ...activeBoat,
          mapX: x,
          mapY: y,
          lastMoved: nowIso,
        };

        const boats = data.boats || [];
        const updatedBoats = boats.map((boat) => {
          if (boat.tokenId === activeBoat.tokenId) {
            const stats = {
              totalXpEarned: boat.stats?.totalXpEarned || 0,
              daysActive: boat.stats?.daysActive || 0,
              timesMoved: (boat.stats?.timesMoved || 0) + 1,
            };
            return {
              ...boat,
              isActive: true,
              position: { x, y, lastMoved: nowIso },
              stats,
            };
          }
          return boat;
        });

        tx.set(newCellRef, {
          userId: req.user.id,
          ownerUsername: data.username,
          boostLevel: data.boost?.level || 'NONE',
          boostImage: data.boost?.image || null,
          boatType: activeBoat.boatType || 'DINGHY',
          xp: activeBoat.dailyXp || 0,
          createdAt: nowIso,
        });

        tx.update(userRef, {
          activeBoat: updatedActiveBoat,
          boats: updatedBoats,
          mapPosition: { x, y, lastMoved: nowIso },
          updatedAt: nowIso,
        });

        return {
          from: { x: activeBoat.mapX, y: activeBoat.mapY },
          to: { x, y },
          movedAt: nowIso,
        };
      });

      if (result?.error) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true, movement: result });
    } catch (error) {
      logger.error('Move boat error:', error);
      res.status(500).json({ error: 'Failed to move boat' });
    }
  }
);

router.post(
  '/fishing-score',
  [
    body('score').isInt({ min: 0, max: 100 }).withMessage('Score must be between 0 and 100'),
    body('reactionMs').optional().isInt({ min: 0, max: 10000 }).withMessage('Reaction time must be between 0-10000 milliseconds'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Invalid score payload', details: errors.array() });
      }

      const { score, reactionMs } = req.body;
      const db = getFirestore();
      const userRef = db.collection('users').doc(req.user.id);
      const nowIso = new Date().toISOString();
      const boostInfo = await getBoostInfo(req.user.walletAddress);

      const result = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(userRef);
        if (!snapshot.exists) {
          throw new Error('User not found');
        }

        const data = snapshot.data();
        const previousHigh = data.miniGame?.highScore || 0;
        const bestReaction = data.miniGame?.bestReactionMs || null;

        const newMiniGame = {
          highScore: Math.max(previousHigh, score),
          bestReactionMs:
            typeof reactionMs === 'number' && reactionMs >= 0
              ? bestReaction
                ? Math.min(reactionMs, bestReaction)
                : reactionMs
              : bestReaction,
          totalGames: (data.miniGame?.totalGames || 0) + 1,
          totalScore: (data.miniGame?.totalScore || 0) + score,
          lastScore: score,
          lastPlayedAt: nowIso,
        };

        const xpAward = Math.max(5, Math.round(score * 3));

        tx.update(userRef, {
          totalXp: (data.totalXp || 0) + xpAward,
          miniGame: newMiniGame,
          boost: boostInfo,
          updatedAt: nowIso,
        });

        return {
          highScore: newMiniGame.highScore,
          totalGames: newMiniGame.totalGames,
          averageScore: newMiniGame.totalScore / newMiniGame.totalGames,
          xpAward,
        };
      });

      res.json({
        success: true,
        result: {
          xpAward: result.xpAward,
          highScore: result.highScore,
          totalGames: result.totalGames,
          averageScore: result.averageScore,
        },
      });
    } catch (error) {
      logger.error('Fishing score submission error:', error);
      res.status(500).json({ error: 'Failed to submit fishing score' });
    }
  }
);

router.get('/map', async (req, res) => {
  try {
    const db = getFirestore();
    const snapshot = await db.collection('mapPlacements').get();

    const boats = snapshot.docs.map((doc) => {
      const [x, y] = doc.id.split('_').map((value) => parseInt(value, 10));
      const data = doc.data();
      return {
        id: doc.id,
        x,
        y,
        boatType: data.boatType,
        owner: data.userId,
        ownerUsername: data.ownerUsername,
        boostLevel: data.boostLevel,
        boostImage: data.boostImage || null,
        xp: data.xp,
        placedAt: data.createdAt,
      };
    });

    res.json({
      success: true,
      map: {
        gridSize: config.game.gridSize,
        boats,
      },
    });
  } catch (error) {
    logger.error('Get map error:', error);
    res.status(500).json({ error: 'Failed to get map state' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const db = getFirestore();
    const userRecord = await getUserDocument(db, req.user.id);
    if (!userRecord) {
      return res.status(404).json({ error: 'User not found' });
    }

    const data = userRecord.data;
    const stats = {
      totalXp: data.totalXp || 0,
      level: calculateLevel(data.totalXp || 0),
      currentStreak: data.currentStreak || 0,
      longestStreak: data.longestStreak || 0,
      daysPlayed: data.createdAt ? Math.ceil((Date.now() - new Date(data.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0,
      boatsOwned: data.boats?.length || 0,
      totalXpEarned: data.boats?.reduce((sum, boat) => sum + (boat.stats?.totalXpEarned || 0), 0) || 0,
      timesMoved: data.boats?.reduce((sum, boat) => sum + (boat.stats?.timesMoved || 0), 0) || 0,
    };

    res.json({ success: true, stats });
  } catch (error) {
    logger.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

module.exports = router;
