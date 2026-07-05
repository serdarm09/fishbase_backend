const express = require('express');
const { query, validationResult } = require('express-validator');
const { getFirestore } = require('../services/firebase');
const { optionalAuth } = require('../middleware/auth');
const { calculateLevel } = require('../utils/gameLogic');

const router = express.Router();

/* ── XP Leaderboard ──────────────────────────────────────────────── */
router.get(
  '/xp',
  optionalAuth,
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Invalid parameters', details: errors.array() });
      }

      const limit  = parseInt(req.query.limit  || '25', 10);
      const offset = parseInt(req.query.offset || '0',  10);
      const db = getFirestore();

      const snapshot = await db
        .collection('users')
        .orderBy('totalXp', 'desc')
        .limit(limit * 2 + offset)
        .get();

      const entries = snapshot.docs
        .map((doc) => doc.data())
        .filter((data) => data.isActive === true)
        .slice(offset, offset + limit)
        .map((data, index) => ({
          rank:     offset + index + 1,
          username: data.username,
          totalXp:  data.totalXp || 0,
          level:    calculateLevel(data.totalXp || 0),
          avatar:   data.profileData?.avatar || '',
          fid:      data.farcasterFid,
        }));

      let userRank = null;
      if (req.user) {
        const userDoc = await db.collection('users').doc(req.user.id).get();
        if (userDoc.exists) {
          const userXp = userDoc.data().totalXp || 0;
          const higherSnapshot = await db
            .collection('users')
            .where('totalXp', '>', userXp)
            .get();
          userRank = higherSnapshot.docs.filter((d) => d.data().isActive === true).length + 1;
        }
      }

      const totalPlayersSnapshot = await db
        .collection('users')
        .where('isActive', '==', true)
        .count()
        .get();

      res.json({
        success: true,
        leaderboard: {
          entries,
          userRank,
          totalPlayers: totalPlayersSnapshot.data().count,
        },
      });
    } catch (error) {
      console.error('[leaderboard/xp] error:', error);
      res.status(500).json({ error: 'Failed to get leaderboard' });
    }
  }
);

/* ── Streak Leaderboard ──────────────────────────────────────────── */
router.get(
  '/streaks',
  [query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Invalid parameters', details: errors.array() });
      }

      const limit = parseInt(req.query.limit || '25', 10);
      const db = getFirestore();

      const snapshot = await db
        .collection('users')
        .orderBy('currentStreak', 'desc')
        .limit(limit * 2)
        .get();

      const entries = snapshot.docs
        .map((doc) => doc.data())
        .filter((data) => data.isActive === true)
        .slice(0, limit)
        .map((data, index) => ({
          rank:          index + 1,
          username:      data.username,
          currentStreak: data.currentStreak || 0,
          longestStreak: data.longestStreak || 0,
          avatar:        data.profileData?.avatar || '',
          fid:           data.farcasterFid,
        }));

      res.json({
        success: true,
        streakLeaderboard: { entries, total: entries.length },
      });
    } catch (error) {
      console.error('[leaderboard/streaks] error:', error);
      res.status(500).json({ error: 'Failed to get streak leaderboard' });
    }
  }
);

/* ── Fishing Mini-Game Leaderboard ───────────────────────────────── */
router.get(
  '/fishing',
  optionalAuth,
  [query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1-50')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Invalid parameters', details: errors.array() });
      }

      const limit = parseInt(req.query.limit || '20', 10);
      const db = getFirestore();

      const snapshot = await db
        .collection('users')
        .where('miniGame.highScore', '>', 0)
        .orderBy('miniGame.highScore', 'desc')
        .limit(limit * 2)
        .get();

      const entries = snapshot.docs
        .map((doc) => doc.data())
        .filter((data) => data.isActive === true)
        .slice(0, limit)
        .map((data, index) => ({
          rank:          index + 1,
          username:      data.username,
          displayName:   data.profileData?.displayName || '',
          highScore:     data.miniGame?.highScore      || 0,
          bestReactionMs: data.miniGame?.bestReactionMs || null,
          totalGames:    data.miniGame?.totalGames     || 0,
        }));

      let userRank = null;
      let userHighScore = null;

      if (req.user) {
        const userDoc = await db.collection('users').doc(req.user.id).get();
        if (userDoc.exists) {
          const data = userDoc.data();
          userHighScore = data.miniGame?.highScore || 0;
          if (userHighScore > 0) {
            const countSnapshot = await db
              .collection('users')
              .where('isActive', '==', true)
              .where('miniGame.highScore', '>', userHighScore)
              .count()
              .get();
            userRank = countSnapshot.data().count + 1;
          }
        }
      }

      res.json({
        success: true,
        fishingLeaderboard: { entries, userRank, userHighScore },
      });
    } catch (error) {
      console.error('[leaderboard/fishing] error:', error);
      res.status(500).json({ error: 'Failed to get fishing leaderboard' });
    }
  }
);

/* ── Stats (summary counts + top players) ────────────────────────── */
router.get('/stats', async (req, res) => {
  try {
    const db = getFirestore();

    // Each sub-query has its own .catch() so a missing Firestore composite
    // index on ONE query doesn't cause the entire /stats endpoint to fail.
    const [playersSnap, boatsSnap, topXpSnap, topStreakSnap] = await Promise.all([
      db.collection('users')
        .where('isActive', '==', true)
        .count()
        .get()
        .catch(() => null),

      db.collection('mapPlacements')
        .count()
        .get()
        .catch(() => null),

      // Single-field orderBy — no composite index needed
      db.collection('users')
        .where('isActive', '==', true)
        .orderBy('totalXp', 'desc')
        .limit(1)
        .get()
        .catch(() => null),

      // Single-field orderBy — no composite index needed
      db.collection('users')
        .where('isActive', '==', true)
        .orderBy('currentStreak', 'desc')
        .limit(1)
        .get()
        .catch(() => null),
    ]);

    const stats = {
      totalPlayers: playersSnap ? playersSnap.data().count : 0,
      totalBoats:   boatsSnap   ? boatsSnap.data().count   : 0,

      topXp: !topXpSnap || topXpSnap.empty
        ? { username: '-', value: 0 }
        : {
            username: topXpSnap.docs[0].data().username || '-',
            value:    topXpSnap.docs[0].data().totalXp  || 0,
          },

      topStreak: !topStreakSnap || topStreakSnap.empty
        ? { username: '-', value: 0 }
        : {
            username: topStreakSnap.docs[0].data().username      || '-',
            value:    topStreakSnap.docs[0].data().currentStreak || 0,
          },
    };

    res.json({ success: true, stats });
  } catch (error) {
    console.error('[leaderboard/stats] error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard stats' });
  }
});

module.exports = router;
