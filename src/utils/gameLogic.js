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

const LAND_MASSES = [
  { cx: 18, cy: 18, rx: 17, ry: 12, rotation: -12 },
  { cx: 22, cy: 59, rx: 14, ry: 25, rotation: 8 },
  { cx: 54, cy: 24, rx: 22, ry: 12, rotation: -5 },
  { cx: 78, cy: 58, rx: 17, ry: 25, rotation: 11 },
  { cx: 50, cy: 83, rx: 21, ry: 10, rotation: -2 },
  { cx: 91, cy: 18, rx: 9, ry: 10, rotation: 0 },
];

function isInsideRotatedEllipse(x, y, land) {
  const angle = (land.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - land.cx;
  const dy = y - land.cy;
  const rotatedX = dx * cos + dy * sin;
  const rotatedY = -dx * sin + dy * cos;

  return (
    (rotatedX * rotatedX) / (land.rx * land.rx) +
      (rotatedY * rotatedY) / (land.ry * land.ry) <=
    1
  );
}

function isSeaCoordinate(x, y, gridSize = 100) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return false;
  }

  if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) {
    return false;
  }

  const normalizedX = (x / (gridSize - 1)) * 100;
  const normalizedY = (y / (gridSize - 1)) * 100;

  return !LAND_MASSES.some((land) => isInsideRotatedEllipse(normalizedX, normalizedY, land));
}

module.exports = {
  calculateLevel,
  xpToNextLevel,
  canClaimDaily,
  getStreakMultiplier,
  hasBoatMovedRecently,
  applyStagnationPenalty,
  isSeaCoordinate,
};
