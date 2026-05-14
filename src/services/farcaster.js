const { ethers } = require('ethers');
const config = require('../config');
const { logger } = require('../utils/logger');

/**
 * Verify Farcaster signature using the custody address recovered from the SIWE message.
 * This implementation does not rely on an external Neynar API and instead validates
 * the provided message/signature pair locally.
 */
async function verifyFarcasterSignature({ message, signature, fid }) {
  try {
    if (!message || !signature) {
      logger.warn('Missing required fields for Farcaster signature verification');
      return null;
    }

    if (!signature.startsWith('0x')) {
      logger.warn('Invalid signature format');
      return null;
    }

    let custodyAddress;
    try {
      custodyAddress = ethers.verifyMessage(message, signature).toLowerCase();
    } catch (verifyError) {
      logger.warn('Failed to recover signer from signature', { error: verifyError.message });
      return null;
    }

    // Attempt to read the fid from the message body if available
    let resolvedFid = Number.isInteger(fid) ? fid : undefined;
    if (!resolvedFid) {
      const fidMatch = /fid[:=]\s*(\d+)/i.exec(message);
      if (fidMatch) {
        resolvedFid = parseInt(fidMatch[1], 10);
      }
    }

    if (!isValidFid(resolvedFid)) {
      logger.warn('Invalid or missing FID in signature payload', { fid: resolvedFid });
      return null;
    }

    logger.auth('Farcaster signature verified locally', {
      fid: resolvedFid,
      custodyAddress,
    });

    return {
      fid: resolvedFid,
      custodyAddress,
      verified: true,
    };
  } catch (error) {
    logger.error('Farcaster signature verification failed:', error);
    return null;
  }
}

/**
 * Get Farcaster user data
 */
async function getFarcasterUserData(fid) {
  try {
    // In production, this would call Farcaster API or read from contracts
    // For now, return mock data structure
    
    return {
      fid: fid,
      username: `user${fid}`,
      custody_address: ethers.Wallet.createRandom().address,
      pfp_url: `https://api.farcaster.xyz/v2/user?fid=${fid}`,
      bio: '',
      verified: false
    };

  } catch (error) {
    logger.error('Failed to get Farcaster user data:', error);
    throw error;
  }
}

/**
 * Validate Farcaster FID
 */
function isValidFid(fid) {
  return Number.isInteger(fid) && fid > 0 && fid < 1000000;
}

/**
 * Generate Farcaster auth URL
 */
function generateAuthUrl(redirectUri) {
  const params = new URLSearchParams({
    client_id: config.farcaster.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'read'
  });

  return `https://warpcast.com/~/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange auth code for access token
 */
async function exchangeCodeForToken(code, redirectUri) {
  try {
    // In production, implement OAuth flow with Farcaster
    const response = await fetch('https://api.farcaster.xyz/v2/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: config.farcaster.clientId,
        client_secret: config.farcaster.clientSecret,
        code: code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!response.ok) {
      throw new Error('Failed to exchange code for token');
    }

    return await response.json();

  } catch (error) {
    logger.error('Failed to exchange code for token:', error);
    throw error;
  }
}

module.exports = {
  verifyFarcasterSignature,
  getFarcasterUserData,
  isValidFid,
  generateAuthUrl,
  exchangeCodeForToken
};
