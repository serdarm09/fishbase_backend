const { ethers } = require('ethers');
const config = require('../config');
const { logger } = require('../utils/logger');

// Contract ABIs (simplified for key functions)
const FISH_TOKEN_ABI = [
  "function mintDailyReward(address to, uint256 xpAmount) external",
  "function mintLevelReward(address to, uint256 level) external",
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)"
];

const BOAT_NFT_ABI = [
  "function mintStarterBoat(address to) external",
  "function getActiveBoat(address user) view returns (uint256 tokenId, uint8 boatType, uint256 dailyXp, string memory name)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function boats(uint256 tokenId) view returns (uint8 boatType, uint256 mintedAt, uint256 lastUsed, bool isActive)",
  "function boatConfigs(uint8 boatType) view returns (string memory name, uint256 dailyXp, uint256 priceEth, uint256 priceUsdc, uint256 maxSupply, uint256 currentSupply, string memory baseURI)"
];

const GAME_CONTROLLER_ABI = [
  "function registerPlayer() external",
  "function placeBoat(uint256 x, uint256 y) external payable",
  "function moveBoat(uint256 newX, uint256 newY) external payable",
  "function claimDaily() external",
  "function getPlayerInfo(address player) view returns (uint256 totalXp, uint256 currentStreak, uint256 longestStreak, uint256 lastClaimDate, uint256 mapX, uint256 mapY, bool hasPosition, bool canClaim)"
];

const GAME_CONTROLLER_INTERFACE = new ethers.Interface(GAME_CONTROLLER_ABI);
const BOAT_TYPE_NAMES = ['DINGHY', 'SAILBOAT', 'YACHT', 'TRAWLER', 'MEGASHIP'];
const BASE_NETWORK = { name: 'base', chainId: 8453 };

function createBaseProvider() {
  return new ethers.JsonRpcProvider(config.blockchain.rpcUrl, BASE_NETWORK, {
    staticNetwork: true,
  });
}

function isConfiguredAddress(address) {
  if (!address || address === ethers.ZeroAddress) {
    return false;
  }

  try {
    ethers.getAddress(address);
    return true;
  } catch {
    return false;
  }
}

function makeStatusError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

class BlockchainService {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.contracts = {};
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize provider
      this.provider = createBaseProvider();
      
      // Initialize signer if private key is provided
      if (config.blockchain.privateKey) {
        this.signer = new ethers.Wallet(config.blockchain.privateKey, this.provider);
      }

      // Initialize contracts
      if (isConfiguredAddress(config.blockchain.contracts.fishToken)) {
        this.contracts.fishToken = new ethers.Contract(
          config.blockchain.contracts.fishToken,
          FISH_TOKEN_ABI,
          this.signer || this.provider
        );
      }

      if (isConfiguredAddress(config.blockchain.contracts.boatNFT)) {
        this.contracts.boatNFT = new ethers.Contract(
          config.blockchain.contracts.boatNFT,
          BOAT_NFT_ABI,
          this.signer || this.provider
        );
      }

      if (isConfiguredAddress(config.blockchain.contracts.gameController)) {
        this.contracts.gameController = new ethers.Contract(
          config.blockchain.contracts.gameController,
          GAME_CONTROLLER_ABI,
          this.signer || this.provider
        );
      }

      this.isInitialized = true;
      logger.blockchain('Blockchain service initialized');

    } catch (error) {
      logger.error('Failed to initialize blockchain service:', error);
      throw error;
    }
  }

  async getBlockNumber() {
    try {
      return await this.provider.getBlockNumber();
    } catch (error) {
      logger.error('Failed to get block number:', error);
      throw error;
    }
  }

  async getBalance(address) {
    try {
      const balance = await this.provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (error) {
      logger.error('Failed to get balance:', error);
      throw error;
    }
  }

  async getFishTokenBalance(address) {
    try {
      if (!this.contracts.fishToken) {
        throw new Error('Fish Token contract not initialized');
      }

      const balance = await this.contracts.fishToken.balanceOf(address);
      return ethers.formatEther(balance);
    } catch (error) {
      logger.error('Failed to get FISH token balance:', error);
      throw error;
    }
  }

  async getBoatNFTBalance(address) {
    try {
      if (!this.contracts.boatNFT) {
        throw new Error('Boat NFT contract not initialized');
      }

      const balance = await this.contracts.boatNFT.balanceOf(address);
      return balance.toString();
    } catch (error) {
      logger.error('Failed to get Boat NFT balance:', error);
      throw error;
    }
  }

  async getActiveBoat(address) {
    try {
      if (!this.contracts.boatNFT) {
        throw new Error('Boat NFT contract not initialized');
      }

      const result = await this.contracts.boatNFT.getActiveBoat(address);
      return {
        tokenId: result[0].toString(),
        boatType: result[1],
        dailyXp: result[2].toString(),
        name: result[3]
      };
    } catch (error) {
      logger.error('Failed to get active boat:', error);
      throw error;
    }
  }

  async getBoatOwnershipDetails(tokenId, expectedOwner) {
    try {
      if (!this.contracts.boatNFT) {
        const error = new Error('Boat NFT contract is not configured');
        error.statusCode = 503;
        throw error;
      }

      const normalizedOwner = ethers.getAddress(expectedOwner);
      const actualOwner = ethers.getAddress(await this.contracts.boatNFT.ownerOf(tokenId));
      if (actualOwner !== normalizedOwner) {
        const error = new Error('Boat NFT is not owned by the authenticated wallet');
        error.statusCode = 403;
        throw error;
      }

      const boatData = await this.contracts.boatNFT.boats(tokenId);
      const boatTypeId = Number(boatData.boatType ?? boatData[0]);
      const boatConfig = await this.contracts.boatNFT.boatConfigs(boatTypeId);
      const dailyXp = Number(boatConfig.dailyXp ?? boatConfig[1]);
      const name = boatConfig.name ?? boatConfig[0] ?? BOAT_TYPE_NAMES[boatTypeId] ?? 'Boat';

      return {
        tokenId: Number(tokenId),
        owner: actualOwner.toLowerCase(),
        boatType: BOAT_TYPE_NAMES[boatTypeId] || 'DINGHY',
        name,
        dailyXp,
        onchain: {
          boatTypeId,
          isActive: Boolean(boatData.isActive ?? boatData[3]),
        },
      };
    } catch (error) {
      logger.error('Failed to verify boat ownership:', { error: error.message, tokenId, expectedOwner });
      throw error;
    }
  }

  async getPlayerInfo(address) {
    try {
      if (!this.contracts.gameController) {
        throw new Error('Game Controller contract not initialized');
      }

      const result = await this.contracts.gameController.getPlayerInfo(address);
      return {
        totalXp: result[0].toString(),
        currentStreak: result[1].toString(),
        longestStreak: result[2].toString(),
        lastClaimDate: result[3].toString(),
        mapX: result[4].toString(),
        mapY: result[5].toString(),
        hasPosition: result[6],
        canClaim: result[7]
      };
    } catch (error) {
      logger.error('Failed to get player info:', error);
      throw error;
    }
  }

  async verifyGameControllerAction(txHash, expectedFrom, methodName, expectedArgs = []) {
    if (!this.contracts.gameController || !isConfiguredAddress(config.blockchain.contracts.gameController)) {
      throw makeStatusError('Game Controller contract is not configured', 503);
    }

    if (!txHash || typeof txHash !== 'string') {
      throw makeStatusError('Transaction hash is required');
    }

    const [receipt, tx] = await Promise.all([
      this.provider.getTransactionReceipt(txHash),
      this.provider.getTransaction(txHash),
    ]);

    if (!receipt || !tx) {
      throw makeStatusError('Transaction was not found or is not mined yet');
    }

    if (receipt.status !== 1) {
      throw makeStatusError('Transaction failed onchain');
    }

    const expectedController = ethers.getAddress(config.blockchain.contracts.gameController);
    const actualTo = tx.to ? ethers.getAddress(tx.to) : null;
    if (actualTo !== expectedController) {
      throw makeStatusError('Transaction does not target the Game Controller');
    }

    const actualFrom = ethers.getAddress(tx.from);
    const normalizedExpectedFrom = ethers.getAddress(expectedFrom);
    if (actualFrom !== normalizedExpectedFrom) {
      throw makeStatusError('Transaction sender does not match authenticated wallet', 403);
    }

    let parsed;
    try {
      parsed = GAME_CONTROLLER_INTERFACE.parseTransaction({ data: tx.data, value: tx.value });
    } catch {
      throw makeStatusError('Transaction data is not a supported Game Controller call');
    }

    if (!parsed || parsed.name !== methodName) {
      throw makeStatusError(`Expected ${methodName} transaction`);
    }

    expectedArgs.forEach((expected, index) => {
      const actual = parsed.args[index];
      if (BigInt(actual) !== BigInt(expected)) {
        throw makeStatusError(`Transaction argument ${index} does not match request`);
      }
    });

    return {
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      method: parsed.name,
      from: actualFrom.toLowerCase(),
      to: expectedController.toLowerCase(),
    };
  }

  async mintStarterBoat(address) {
    try {
      if (!this.contracts.boatNFT || !this.signer) {
        throw new Error('Boat NFT contract or signer not available');
      }

      const tx = await this.contracts.boatNFT.mintStarterBoat(address);
      logger.blockchain('Starter boat minting transaction sent', { txHash: tx.hash, to: address });
      
      const receipt = await tx.wait();
      logger.blockchain('Starter boat minted successfully', { txHash: receipt.hash, to: address });
      
      return receipt;
    } catch (error) {
      logger.error('Failed to mint starter boat:', error);
      throw error;
    }
  }

  async mintDailyReward(address, xpAmount) {
    try {
      if (!this.contracts.fishToken || !this.signer) {
        throw new Error('Fish Token contract or signer not available');
      }

      const tx = await this.contracts.fishToken.mintDailyReward(address, xpAmount);
      logger.blockchain('Daily reward minting transaction sent', { txHash: tx.hash, to: address, xpAmount });
      
      const receipt = await tx.wait();
      logger.blockchain('Daily reward minted successfully', { txHash: receipt.hash, to: address });
      
      return receipt;
    } catch (error) {
      logger.error('Failed to mint daily reward:', error);
      throw error;
    }
  }

  async verifyTransaction(txHash) {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      return receipt && receipt.status === 1;
    } catch (error) {
      logger.error('Failed to verify transaction:', error);
      return false;
    }
  }

  async waitForTransaction(txHash, confirmations = 1) {
    try {
      const receipt = await this.provider.waitForTransaction(txHash, confirmations);
      return receipt;
    } catch (error) {
      logger.error('Failed to wait for transaction:', error);
      throw error;
    }
  }

  async estimateGas(contract, method, params) {
    try {
      const gasEstimate = await contract[method].estimateGas(...params);
      return gasEstimate.toString();
    } catch (error) {
      logger.error('Failed to estimate gas:', error);
      throw error;
    }
  }

  async getCurrentGasPrice() {
    try {
      const gasPrice = await this.provider.getFeeData();
      return {
        gasPrice: gasPrice.gasPrice ? ethers.formatUnits(gasPrice.gasPrice, 'gwei') : null,
        maxFeePerGas: gasPrice.maxFeePerGas ? ethers.formatUnits(gasPrice.maxFeePerGas, 'gwei') : null,
        maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas ? ethers.formatUnits(gasPrice.maxPriorityFeePerGas, 'gwei') : null
      };
    } catch (error) {
      logger.error('Failed to get gas price:', error);
      throw error;
    }
  }
}

const blockchainService = new BlockchainService();

module.exports = {
  initialize: () => blockchainService.initialize(),
  blockchainService,
};
