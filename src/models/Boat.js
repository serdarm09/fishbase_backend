const mongoose = require('mongoose');

const boatSchema = new mongoose.Schema({
  // Owner info
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  walletAddress: {
    type: String,
    required: true,
    lowercase: true,
    index: true
  },
  
  // NFT data
  nftTokenId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  contractAddress: {
    type: String,
    required: true,
    lowercase: true
  },
  
  // Boat properties
  boatType: {
    type: String,
    enum: ['DINGHY', 'SAILBOAT', 'YACHT', 'TRAWLER', 'MEGASHIP'],
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  dailyXp: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Position data
  mapX: {
    type: Number,
    min: 0,
    max: 99,
    default: null
  },
  mapY: {
    type: Number,
    min: 0,
    max: 99,
    default: null
  },
  placedAt: {
    type: Date,
    default: null
  },
  lastMoved: {
    type: Date,
    default: null
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: false
  },
  isPlaced: {
    type: Boolean,
    default: false
  },
  
  // Metadata
  metadata: {
    image: String,
    description: String,
    attributes: [{
      trait_type: String,
      value: mongoose.Schema.Types.Mixed
    }]
  },
  
  // Stats
  stats: {
    totalXpEarned: {
      type: Number,
      default: 0
    },
    daysActive: {
      type: Number,
      default: 0
    },
    timesMoved: {
      type: Number,
      default: 0
    },
    lastClaimDate: {
      type: Date,
      default: null
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for days since last move
boatSchema.virtual('daysSinceLastMove').get(function() {
  if (!this.lastMoved) return 0;
  
  const now = new Date();
  const diffTime = Math.abs(now - this.lastMoved);
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for movement bonus eligibility
boatSchema.virtual('hasMovementBonus').get(function() {
  return this.daysSinceLastMove <= 3;
});

// Virtual for XP with modifiers
boatSchema.virtual('currentDailyXp').get(function() {
  let xp = this.dailyXp;
  
  // Apply movement bonus
  if (this.hasMovementBonus) {
    xp *= 2; // 100% bonus
  }
  
  // Apply decay for stationary boats
  const daysSinceMove = this.daysSinceLastMove;
  if (daysSinceMove > 3) {
    const decayRate = 0.05; // 5% per day
    const decayDays = daysSinceMove - 3;
    xp = xp * Math.pow(1 - decayRate, decayDays);
  }
  
  return Math.floor(xp);
});

// Indexes for performance
boatSchema.index({ userId: 1, isActive: 1 }); // User's active boat
boatSchema.index({ mapX: 1, mapY: 1 }); // Map position queries
boatSchema.index({ nftTokenId: 1 }); // NFT lookup
boatSchema.index({ boatType: 1 }); // Type filtering
boatSchema.index({ isPlaced: 1 }); // Placed boats
boatSchema.index({ 'stats.totalXpEarned': -1 }); // Boat leaderboard

// Methods
boatSchema.methods.placeOnMap = function(x, y) {
  this.mapX = x;
  this.mapY = y;
  this.isPlaced = true;
  this.placedAt = new Date();
  this.lastMoved = new Date();
  this.stats.timesMoved += 1;
};

boatSchema.methods.moveToPosition = function(x, y) {
  this.mapX = x;
  this.mapY = y;
  this.lastMoved = new Date();
  this.stats.timesMoved += 1;
};

boatSchema.methods.activate = function() {
  this.isActive = true;
};

boatSchema.methods.deactivate = function() {
  this.isActive = false;
};

boatSchema.methods.claimXp = function(xpAmount) {
  this.stats.totalXpEarned += xpAmount;
  this.stats.lastClaimDate = new Date();
  this.stats.daysActive += 1;
};

boatSchema.methods.canClaim = function() {
  if (!this.stats.lastClaimDate) return true;
  
  const now = new Date();
  const lastClaim = new Date(this.stats.lastClaimDate);
  const hoursSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60);
  
  return hoursSinceLastClaim >= 24;
};

// Static methods
boatSchema.statics.findByTokenId = function(tokenId) {
  return this.findOne({ nftTokenId: tokenId });
};

boatSchema.statics.findActiveByUser = function(userId) {
  return this.findOne({ userId, isActive: true });
};

boatSchema.statics.findByPosition = function(x, y) {
  return this.findOne({ mapX: x, mapY: y, isPlaced: true });
};

boatSchema.statics.getMapState = function() {
  return this.find({ isPlaced: true })
    .select('mapX mapY boatType userId nftTokenId stats.totalXpEarned')
    .populate('userId', 'username profileData.avatar')
    .lean();
};

boatSchema.statics.getBoatLeaderboard = function(limit = 100) {
  return this.find({ isPlaced: true })
    .sort({ 'stats.totalXpEarned': -1 })
    .limit(limit)
    .select('boatType stats.totalXpEarned userId nftTokenId')
    .populate('userId', 'username profileData.avatar')
    .lean();
};

boatSchema.statics.getBoatsByType = function(boatType) {
  return this.find({ boatType, isPlaced: true })
    .select('mapX mapY userId stats.totalXpEarned')
    .populate('userId', 'username')
    .lean();
};

// Pre-save middleware
boatSchema.pre('save', function(next) {
  // Ensure wallet address is lowercase
  if (this.walletAddress) {
    this.walletAddress = this.walletAddress.toLowerCase();
  }
  
  // Ensure contract address is lowercase
  if (this.contractAddress) {
    this.contractAddress = this.contractAddress.toLowerCase();
  }
  
  next();
});

// Pre-remove middleware to handle cleanup
boatSchema.pre('remove', function(next) {
  // If this was an active boat, we might need to activate another boat for the user
  if (this.isActive) {
    // This could be handled in the service layer
  }
  next();
});

module.exports = mongoose.model('Boat', boatSchema);
