const { ethers } = require('ethers');
const config = require('../config');
const { logger } = require('../utils/logger');

const BOOST_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)'
];

let provider;
let contract;

function ensureProvider() {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.blockchain.rpcUrl);
  }
  return provider;
}

function ensureContract() {
  if (!config.blockchain.contracts.boostNFT) {
    return null;
  }
  if (!contract) {
    const prov = ensureProvider();
    contract = new ethers.Contract(config.blockchain.contracts.boostNFT, BOOST_ABI, prov);
  }
  return contract;
}

async function getBoostInfo(walletAddress) {
  try {
    if (!walletAddress) {
      return {
        level: 'NONE',
        multiplier: 0,
        tokenId: null,
        name: 'No Boost',
        image: null,
      };
    }

    const contractInstance = ensureContract();
    if (!contractInstance) {
      return {
        level: 'NONE',
        multiplier: 0,
        tokenId: null,
        name: 'No Boost',
        image: null,
      };
    }

    const normalized = walletAddress.toLowerCase();
    let best = {
      level: 'NONE',
      multiplier: 0,
      tokenId: null,
      name: 'No Boost',
      image: null,
    };

    for (const boostLevel of config.boostLevels) {
      const balance = await contractInstance.balanceOf(normalized, boostLevel.id);
      if (balance && balance > 0n && boostLevel.multiplier > best.multiplier) {
        best = {
          level: boostLevel.level,
          multiplier: boostLevel.multiplier,
          tokenId: boostLevel.id,
          name: boostLevel.name,
          image: boostLevel.image,
        };
      }
    }

    return best;
  } catch (error) {
    logger.error('Failed to fetch boost info', { error: error.message });
    return {
      level: 'NONE',
      multiplier: 0,
      tokenId: null,
      name: 'No Boost',
      image: null,
    };
  }
}

module.exports = {
  getBoostInfo,
};
