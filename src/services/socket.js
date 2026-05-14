const { logger } = require('../utils/logger');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getFirestore } = require('./firebase');

class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socketId
    this.userSockets = new Map(); // socketId -> userId
  }

  initialize(io) {
    this.io = io;

    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        
        if (!token) {
          return next(new Error('Authentication error'));
        }

        const decoded = jwt.verify(token, config.jwt.secret);
        const db = getFirestore();
        const userSnap = await db.collection('users').doc(decoded.userId).get();

        if (!userSnap.exists || userSnap.data()?.isActive === false) {
          return next(new Error('User not found'));
        }

        const user = userSnap.data();
        socket.userId = userSnap.id;
        socket.username = user.username;
        next();
      } catch (error) {
        next(new Error('Authentication error'));
      }
    });

    io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    logger.info('Socket.IO service initialized');
  }

  handleConnection(socket) {
    const userId = socket.userId;
    const username = socket.username;

    // Store user connection
    this.connectedUsers.set(userId, socket.id);
    this.userSockets.set(socket.id, userId);

    logger.info('User connected via socket', { userId, username, socketId: socket.id });

    // Join user to their personal room
    socket.join(`user:${userId}`);

    // Join global game room
    socket.join('game');

    // Send welcome message
    socket.emit('connected', {
      message: 'Connected to FishBase',
      userId: userId,
      timestamp: new Date().toISOString()
    });

    // Broadcast user online status
    socket.to('game').emit('user-online', {
      userId: userId,
      username: username
    });

    // Handle boat placement
    socket.on('place-boat', (data) => {
      this.handleBoatPlacement(socket, data);
    });

    // Handle boat movement
    socket.on('move-boat', (data) => {
      this.handleBoatMovement(socket, data);
    });

    // Handle daily claim
    socket.on('daily-claim', (data) => {
      this.handleDailyClaim(socket, data);
    });

    // Handle chat messages
    socket.on('chat-message', (data) => {
      this.handleChatMessage(socket, data);
    });

    // Handle map updates request
    socket.on('request-map-update', () => {
      this.sendMapUpdate(socket);
    });

    // Handle leaderboard request
    socket.on('request-leaderboard', () => {
      this.sendLeaderboardUpdate(socket);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnection(socket);
    });
  }

  handleBoatPlacement(socket, data) {
    const { x, y, boatType } = data;
    
    // Broadcast to all users in game room
    socket.to('game').emit('boat-placed', {
      userId: socket.userId,
      username: socket.username,
      x: x,
      y: y,
      boatType: boatType,
      timestamp: new Date().toISOString()
    });

    logger.game('Boat placed via socket', {
      userId: socket.userId,
      username: socket.username,
      position: { x, y },
      boatType
    });
  }

  handleBoatMovement(socket, data) {
    const { fromX, fromY, toX, toY, boatType } = data;
    
    // Broadcast to all users in game room
    socket.to('game').emit('boat-moved', {
      userId: socket.userId,
      username: socket.username,
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY },
      boatType: boatType,
      timestamp: new Date().toISOString()
    });

    logger.game('Boat moved via socket', {
      userId: socket.userId,
      username: socket.username,
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY }
    });
  }

  handleDailyClaim(socket, data) {
    const { xpEarned, newStreak, totalXp } = data;
    
    // Broadcast to all users in game room
    socket.to('game').emit('user-claimed', {
      userId: socket.userId,
      username: socket.username,
      xpEarned: xpEarned,
      newStreak: newStreak,
      totalXp: totalXp,
      timestamp: new Date().toISOString()
    });

    logger.game('Daily claim via socket', {
      userId: socket.userId,
      username: socket.username,
      xpEarned,
      newStreak
    });
  }

  handleChatMessage(socket, data) {
    const { message, channel = 'general' } = data;
    
    // Basic message validation
    if (!message || message.trim().length === 0 || message.length > 500) {
      socket.emit('error', { message: 'Invalid message' });
      return;
    }

    const chatData = {
      id: Date.now().toString(),
      userId: socket.userId,
      username: socket.username,
      message: message.trim(),
      channel: channel,
      timestamp: new Date().toISOString()
    };

    // Broadcast to all users in game room
    this.io.to('game').emit('chat-message', chatData);

    logger.info('Chat message sent', {
      userId: socket.userId,
      username: socket.username,
      channel,
      messageLength: message.length
    });
  }

  handleDisconnection(socket) {
    const userId = socket.userId;
    const username = socket.username;

    // Remove from tracking
    this.connectedUsers.delete(userId);
    this.userSockets.delete(socket.id);

    // Broadcast user offline status
    socket.to('game').emit('user-offline', {
      userId: userId,
      username: username
    });

    logger.info('User disconnected', { userId, username, socketId: socket.id });
  }

  // Utility methods for sending updates
  sendToUser(userId, event, data) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  sendToAllUsers(event, data) {
    this.io.to('game').emit(event, data);
  }

  sendMapUpdate(socket) {
    // This would typically fetch current map state and send it
    socket.emit('map-update', {
      message: 'Map update requested',
      timestamp: new Date().toISOString()
    });
  }

  sendLeaderboardUpdate(socket) {
    // This would typically fetch current leaderboard and send it
    socket.emit('leaderboard-update', {
      message: 'Leaderboard update requested',
      timestamp: new Date().toISOString()
    });
  }

  broadcastBoatPlacement(userId, username, x, y, boatType) {
    this.sendToAllUsers('boat-placed', {
      userId,
      username,
      x,
      y,
      boatType,
      timestamp: new Date().toISOString()
    });
  }

  broadcastBoatMovement(userId, username, from, to, boatType) {
    this.sendToAllUsers('boat-moved', {
      userId,
      username,
      from,
      to,
      boatType,
      timestamp: new Date().toISOString()
    });
  }

  broadcastDailyClaim(userId, username, xpEarned, newStreak, totalXp) {
    this.sendToAllUsers('user-claimed', {
      userId,
      username,
      xpEarned,
      newStreak,
      totalXp,
      timestamp: new Date().toISOString()
    });
  }

  broadcastLeaderboardUpdate(leaderboard) {
    this.sendToAllUsers('leaderboard-update', {
      leaderboard,
      timestamp: new Date().toISOString()
    });
  }

  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }

  isUserOnline(userId) {
    return this.connectedUsers.has(userId);
  }
}

const socketService = new SocketService();

module.exports = socketService;
