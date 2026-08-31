import crypto from 'crypto';

/**
 * Calculates the SHA-256 hash for a given block's data.
 * @param {Object} block - The block parameters
 * @param {string} block.productId - The unique ID of the product
 * @param {string} block.previousHash - The hash of the previous block
 * @param {string} block.timestamp - The ISO timestamp of the action
 * @param {string} block.actor - The actor performing the action (Manufacturer, Distributor, etc.)
 * @param {string} block.actorWalletAddress - The simulated wallet address of the actor
 * @param {string} block.location - The physical location of the action
 * @param {string} block.action - The action description
 * @returns {string} The computed SHA-256 hash
 */
export function calculateBlockHash({ productId, previousHash, timestamp, actor, actorWalletAddress, location, action }) {
  const dataString = `${previousHash || '0'}|${productId}|${timestamp}|${actor}|${actorWalletAddress}|${location}|${action}`;
  return crypto.createHash('sha256').update(dataString).digest('hex');
}

/**
 * Verifies the integrity of a product's blockchain.
 * Ensures each block hash matches its contents and previousHash matches the prior block's currentHash.
 * @param {Array} blocks - Array of blocks for a single product
 * @returns {Object} { isValid: boolean, reason: string | null }
 */
export function verifyChain(blocks) {
  if (!blocks || blocks.length === 0) {
    return { isValid: true, reason: null };
  }

  // Ensure blocks are sorted by block_index ascending
  const sorted = [...blocks].sort((a, b) => a.block_index - b.block_index);

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];

    // 1. Recalculate block hash
    const computedHash = calculateBlockHash({
      productId: current.product_id,
      previousHash: current.previous_hash,
      timestamp: current.timestamp,
      actor: current.actor,
      actorWalletAddress: current.actor_wallet_address,
      location: current.location,
      action: current.action
    });

    if (computedHash !== current.current_hash) {
      return {
        isValid: false,
        reason: `Hash mismatch at block index ${current.block_index}. Computed: ${computedHash.substring(0, 10)}..., Database: ${current.current_hash.substring(0, 10)}...`
      };
    }

    // 2. Verify link with previous block
    if (i > 0) {
      const prev = sorted[i - 1];
      if (current.previous_hash !== prev.current_hash) {
        return {
          isValid: false,
          reason: `Chain broken at block index ${current.block_index}. Previous hash (${current.previous_hash.substring(0, 10)}...) does not match prior block hash (${prev.current_hash.substring(0, 10)}...).`
        };
      }
    } else {
      // Genesis block check
      if (current.previous_hash !== '0') {
        return {
          isValid: false,
          reason: `Genesis block index 0 must have previous hash '0', got '${current.previous_hash}'`
        };
      }
    }
  }

  return { isValid: true, reason: null };
}
