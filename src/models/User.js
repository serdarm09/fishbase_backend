const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Farcaster data
  farcasterFid: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  username: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  walletAddress: {
    type: String,
    required: true,
    lowercase: true,
    index: true
  },
  
  // Game stats
  totalFish: {
    type: Number,
    default: 0,
    min: 0
  },
  totalXp: {
    type: Number,
    default: 0,
    min: 0,
    index: true // For leaderboard queries
  },
  currentStreak: {
    type: Number,
    default: 0,
    min: 0
  },
  longestStreak: {
    type: Number,
    default: 0,
    min: 0
  },
  lastClaimDate: {
    type: Date,
    default: null
  },
  
  // Profile data
  profileData: {
    bio: {
      type: String,
      maxlength: 200,
      default: ''
    },
    avatar: {
      type: String,
      default: ''
    },
    pfpUrl: {
      type: String,
      default: ''
    },
    displayName: {
      type: String,
      default: ''
    }
  },
  
  // Game position
  mapPosition: {
    x: {
      type: Number,
      min: 0,
      max: 99,
      default: null
    },
    y: {
      type: Number,
      min: 0,
      max: 99,
      default: null
    },
    lastMoved: {
      type: Date,
      default: null
    }
  },
  
  // Achievements
  achievements: [{
    id: String,
    name: String,
    description: String,
    icon: String,
    unlockedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Settings
  settings: {
    notifications: {
      type: Boolean,
      default: true
    },
    publicProfile: {
      type: Boolean,
      default: true
    }
  },

  // Fishing mini-game stats
  miniGame: {
    highScore: {
      type: Number,
      default: 0,
      min: 0
    },
    bestReactionMs: {
      type: Number,
      default: null,
      min: 0
    },
    totalGames: {
      type: Number,
      default: 0,
      min: 0
    },
    totalScore: {
      type: Number,
      default: 0,
      min: 0
    },
    lastScore: {
      type: Number,
      default: 0,
      min: 0
    },
    lastPlayedAt: {
      type: Date,
      default: null
    }
  },
  
  // Metadata
  isActive: {
    type: Boolean,
    default: true
  },
  lastLoginAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for current level calculation
userSchema.virtual('level').get(function() {
  if (this.totalXp < 100) return 1;
  return Math.floor(Math.log10(this.totalXp / 100) * 10) + 1;
});

// Virtual for XP needed for next level
userSchema.virtual('xpToNextLevel').get(function() {
  const currentLevel = this.level;
  const nextLevelXp = Math.pow(10, (currentLevel / 10)) * 100;
  return Math.max(0, nextLevelXp - this.totalXp);
});

// Virtual for days played
userSchema.virtual('daysPlayed').get(function() {
  if (!this.createdAt) return 0;
  const diffTime = Math.abs(new Date() - this.createdAt);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Indexes for performance
userSchema.index({ totalXp: -1 }); // Leaderboard
userSchema.index({ farcasterFid: 1 }); // Auth lookup
userSchema.index({ walletAddress: 1 }); // Blockchain lookup
userSchema.index({ 'mapPosition.x': 1, 'mapPosition.y': 1 }); // Map queries
userSchema.index({ lastClaimDate: 1 }); // Daily claim queries
userSchema.index({ createdAt: -1 }); // Recent users
userSchema.index({ 'miniGame.highScore': -1 }); // Mini-game leaderboard

// Methods
userSchema.methods.canClaimDaily = function() {
  if (!this.lastClaimDate) return true;
  
  const now = new Date();
  const lastClaim = new Date(this.lastClaimDate);
  const hoursSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60);
  
  return hoursSinceLastClaim >= 24;
};

userSchema.methods.getStreakMultiplier = function() {
  const streak = this.currentStreak;
  if (streak >= 100) return 10.0;
  if (streak >= 30) return 5.0;
  if (streak >= 14) return 3.0;
  if (streak >= 7) return 2.0;
  
  // Linear progression from 1.0x to 1.5x for days 1-6
  return 1.0 + ((streak - 1) * 0.1);
};

userSchema.methods.addAchievement = function(achievement) {
  const exists = this.achievements.some(a => a.id === achievement.id);
  if (!exists) {
    this.achievements.push({
      ...achievement,
      unlockedAt: new Date()
    });
  }
};

userSchema.methods.updateMapPosition = function(x, y) {
  this.mapPosition.x = x;
  this.mapPosition.y = y;
  this.mapPosition.lastMoved = new Date();
};

// Static methods
userSchema.statics.getLeaderboard = function(limit = 100, offset = 0) {
  return this.find({ isActive: true })
    .sort({ totalXp: -1 })
    .limit(limit)
    .skip(offset)
    .select('username totalXp profileData.avatar farcasterFid level')
    .lean();
};

userSchema.statics.findByFarcasterFid = function(fid) {
  return this.findOne({ farcasterFid: fid });
};

userSchema.statics.findByWallet = function(address) {
  return this.findOne({ walletAddress: address.toLowerCase() });
};

// Pre-save middleware
userSchema.pre('save', function(next) {
  // Update lastLoginAt on any save
  if (this.isModified() && !this.isNew) {
    this.lastLoginAt = new Date();
  }
  
  // Ensure wallet address is lowercase
  if (this.walletAddress) {
    this.walletAddress = this.walletAddress.toLowerCase();
  }
  
  next();
});

// Post-save middleware for achievements
userSchema.post('save', function(doc) {
  // Check for level-based achievements
  const level = doc.level;
  const milestones = [5, 10, 25, 50, 100];
  
  milestones.forEach(milestone => {
    if (level >= milestone) {
      doc.addAchievement({
        id: `level_${milestone}`,
        name: `Level ${milestone} Master`,
        description: `Reached level ${milestone}`,
        icon: '🏆'
      });
    }
  });
  
  // Check for streak achievements
  const streak = doc.currentStreak;
  const streakMilestones = [7, 14, 30, 100];
  
  streakMilestones.forEach(milestone => {
    if (streak >= milestone) {
      doc.addAchievement({
        id: `streak_${milestone}`,
        name: `${milestone} Day Streak`,
        description: `Maintained a ${milestone} day streak`,
        icon: '🔥'
      });
    }
  });
});

module.exports = mongoose.model('User', userSchema);
