const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { getFirestore } = require('../services/firebase');
const config = require('../config');
const { blockchainService } = require('../services/blockchain');

const router = express.Router();

function validateRequest(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: 'Validation failed', details: errors.array() });
    return false;
  }
  return true;
}

function sendChainError(res, error) {
  const status = error.statusCode || 500;
  res.status(status).json({
    error: error.message || 'Blockchain ownership verification failed',
  });
}

router.get('/boats', async (req, res) => {
  try {
    const db = getFirestore();
    const userSnap = await db.collection('users').doc(req.user.id).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const data = userSnap.data();
    res.json({
      success: true,
      boats: data.boats || [],
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get boats' });
  }
});

router.get('/marketplace', async (_req, res) => {
  const starterBoats = [
    {
      type: 'DINGHY',
      name: 'Dinghy',
      dailyXp: 10,
      price: 'Free',
      description: 'Your starter vessel — claim it free when you join.',
      boost: '+0% XP',
      rarity: 'Starter',
      image: '/boosts/ship_v1-Photoroom.png',
    },
    {
      type: 'SAILBOAT',
      name: 'Sailboat',
      dailyXp: 25,
      price: '1.00',
      description: 'A nimble sail for active captains who love the wind.',
      boost: '+0% XP',
      rarity: 'Common',
      image: '/boosts/ship_v2-Photoroom.png',
    },
    {
      type: 'YACHT',
      name: 'Yacht',
      dailyXp: 50,
      price: '3.00',
      description: 'Sleek cruiser with twice the earning power.',
      boost: '+0% XP',
      rarity: 'Rare',
      image: '/boosts/ship_v3-Photoroom.png',
    },
    {
      type: 'TRAWLER',
      name: 'Deepwater Trawler',
      dailyXp: 100,
      price: '5.00',
      description: 'Heavy-duty commercial trawler built for serious fishing.',
      boost: '+0% XP',
      rarity: 'Epic',
      image: '/boosts/ship_v4-Photoroom.png',
    },
    {
      type: 'MEGASHIP',
      name: 'Mega Ship',
      dailyXp: 200,
      price: '6.99',
      description: 'The ultimate ocean liner — maximum XP, maximum prestige.',
      boost: '+0% XP',
      rarity: 'Legendary',
      image: '/boosts/ship_v5-Photoroom.png',
    },
  ];

  res.json({
    success: true,
    marketplace: {
      boats: starterBoats,
      boosts: config.boostLevels,
    },
  });
});

router.post(
  '/boats/:tokenId/activate',
  [param('tokenId').isInt({ min: 1 }).withMessage('Invalid token ID')],
  async (req, res) => {
    if (!validateRequest(req, res)) return;

    try {
      const tokenId = parseInt(req.params.tokenId, 10);
      const chainBoat = await blockchainService.getBoatOwnershipDetails(tokenId, req.user.walletAddress);
      const db = getFirestore();
      const userRef = db.collection('users').doc(req.user.id);

      const result = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(userRef);
        if (!snapshot.exists) {
          throw new Error('User not found');
        }

        const data = snapshot.data();
        const boats = data.boats || [];
        const selectedBoat = boats.find((boat) => boat.tokenId === tokenId);
        if (!selectedBoat) {
          return { error: 'Boat not found' };
        }

        const refreshedBoat = {
          ...selectedBoat,
          boatType: chainBoat.boatType,
          type: chainBoat.boatType,
          name: chainBoat.name,
          dailyXp: chainBoat.dailyXp,
          isActive: true,
          verifiedAt: new Date().toISOString(),
        };

        const updatedBoats = boats.map((boat) => (
          boat.tokenId === tokenId
            ? refreshedBoat
            : { ...boat, isActive: false }
        ));

        tx.update(userRef, {
          boats: updatedBoats,
          activeBoat: {
            ...refreshedBoat,
            mapX: refreshedBoat.position?.x ?? null,
            mapY: refreshedBoat.position?.y ?? null,
            lastMoved: refreshedBoat.position?.lastMoved ?? null,
          },
          updatedAt: new Date().toISOString(),
        });

        return {
          tokenId,
          boatType: refreshedBoat.boatType,
          type: refreshedBoat.type,
          dailyXp: refreshedBoat.dailyXp,
        };
      });

      if (result?.error) {
        return res.status(404).json({ error: result.error });
      }

      res.json({
        success: true,
        message: 'Boat activated successfully',
        activeBoat: result,
      });
    } catch (error) {
      sendChainError(res, error);
    }
  }
);

router.post(
  '/register-boat',
  [
    body('tokenId').isInt({ min: 1 }).withMessage('Token ID is required'),
    body('boatType').optional().isString(),
    body('dailyXp').optional().isInt({ min: 1 }),
    body('name').optional().isString(),
    body('image').optional().isString(),
  ],
  async (req, res) => {
    if (!validateRequest(req, res)) return;

    try {
      const tokenId = parseInt(req.body.tokenId, 10);
      const { image } = req.body;
      const chainBoat = await blockchainService.getBoatOwnershipDetails(tokenId, req.user.walletAddress);
      const db = getFirestore();
      const userRef = db.collection('users').doc(req.user.id);
      const nowIso = new Date().toISOString();
      let registeredBoat;

      const result = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(userRef);
        if (!snapshot.exists) {
          throw new Error('User not found');
        }

        const data = snapshot.data();
        const boats = data.boats || [];
        const exists = boats.some((boat) => boat.tokenId === tokenId);
        if (exists) {
          return { error: 'Boat already registered' };
        }

        const newBoat = {
          tokenId,
          boatType: chainBoat.boatType,
          type: chainBoat.boatType,
          name: chainBoat.name,
          dailyXp: chainBoat.dailyXp,
          position: null,
          isActive: boats.length === 0,
          stats: {
            totalXpEarned: 0,
            daysActive: 0,
            timesMoved: 0,
          },
          image: image || null,
          onchainOwner: chainBoat.owner,
          verifiedAt: nowIso,
          createdAt: nowIso,
        };

        const updatedBoats = [...boats, newBoat];
        const updates = {
          boats: updatedBoats,
          updatedAt: nowIso,
        };

        if (newBoat.isActive || !data.activeBoat) {
          updates.activeBoat = {
            ...newBoat,
            mapX: null,
            mapY: null,
            lastMoved: null,
          };
        }

        registeredBoat = newBoat;
        tx.update(userRef, updates);
        return { boat: newBoat };
      });

      if (result?.error) {
        return res.status(409).json({ error: result.error });
      }

      res.json({
        success: true,
        message: 'Boat registered successfully',
        boat: registeredBoat,
      });
    } catch (error) {
      sendChainError(res, error);
    }
  }
);

module.exports = router;
