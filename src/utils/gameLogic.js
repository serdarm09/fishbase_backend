const config = require('../config');

function calculateLevel(totalXp = 0) {
  if (!totalXp || totalXp < 100) {
    return 1;
  }
  return Math.floor(Math.log10(totalXp / 100) * 10) + 1;
}

function xpToNextLevel(totalXp = 0) {
  const level = calculateLevel(totalXp);
  const nextLevelXp = Math.pow(10, level / 10) * 100;
  const remaining = Math.max(0, nextLevelXp - totalXp);
  return Math.round(remaining);
}

function canClaimDaily(userData) {
  const lastClaimDate = userData?.lastClaimDate;
  if (!lastClaimDate) {
    return true;
  }

  const lastClaim = new Date(lastClaimDate).getTime();
  const now = Date.now();
  const hoursSinceClaim = (now - lastClaim) / (1000 * 60 * 60);
  return hoursSinceClaim >= 24;
}

function getStreakMultiplier(streak = 0) {
  if (streak >= 100) return 10.0;
  if (streak >= 30) return 5.0;
  if (streak >= 14) return 3.0;
  if (streak >= 7) return 2.0;
  return 1.0 + Math.max(0, streak - 1) * 0.1;
}

function hasBoatMovedRecently(lastMoved) {
  if (!lastMoved) return false;
  const last = new Date(lastMoved).getTime();
  const now = Date.now();
  const hours = (now - last) / (1000 * 60 * 60);
  return hours < 24;
}

function applyStagnationPenalty(baseXp) {
  const multiplier = config.game.stagnantXpMultiplier || 0.1;
  return Math.floor(baseXp * multiplier);
}

module.exports = {
  calculateLevel,
  xpToNextLevel,
  canClaimDaily,
  getStreakMultiplier,
  hasBoatMovedRecently,
  applyStagnationPenalty,
};
