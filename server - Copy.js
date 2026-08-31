import express from 'express';
import cors from 'cors';
import { initDb, dbAll, dbGet, dbRun } from './db.js';
import { calculateBlockHash, verifyChain } from './blockchain.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize Database
initDb().catch(err => {
  console.error('Failed to initialize database:', err);
});

// API Routes

// 1. Get all products (Admin / general list)
app.get('/api/products', async (req, res) => {
  try {
    const products = await dbAll('SELECT * FROM products ORDER BY created_at DESC');
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Register a new product (Manufacturer)
app.post('/api/products', async (req, res) => {
  const { name, batchNumber, category, manufacturingLocation, actor, actorWalletAddress } = req.body;

  if (!name || !batchNumber || !category || !manufacturingLocation || !actor || !actorWalletAddress) {
    return res.status(400).json({ error: 'All product fields are required.' });
  }

  // Generate unique product ID using timestamp + random string
  const productId = `prod-${category.toLowerCase().substring(0, 3)}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const timestamp = new Date().toISOString();

  try {
    // 1. Create Genesis Block
    const genesisPrevHash = '0';
    const genesisAction = 'Registered product & created Genesis Block';
    const currentHash = calculateBlockHash({
      productId,
      previousHash: genesisPrevHash,
      timestamp,
      actor,
      actorWalletAddress,
      location: manufacturingLocation,
      action: genesisAction
    });

    // 2. Insert into products
    await dbRun(`
      INSERT INTO products (id, name, batch_number, manufacturing_date, category, manufacturing_location, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [productId, name, batchNumber, timestamp.split('T')[0], category, manufacturingLocation, 'REGISTERED', timestamp]);

    // 3. Insert Genesis Block
    await dbRun(`
      INSERT INTO blocks (product_id, block_index, previous_hash, timestamp, actor, actor_wallet_address, location, action, current_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [productId, 0, genesisPrevHash, timestamp, actor, actorWalletAddress, manufacturingLocation, genesisAction, currentHash]);

    res.status(201).json({
      message: 'Product registered successfully.',
      productId,
      status: 'REGISTERED'
    });
  } catch (error) {
    console.error('Error registering product:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Get product details by ID
app.get('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const product = await dbGet('SELECT * FROM products WHERE id = ?', [id]);
    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Get all blocks (chain history) for a product
app.get('/api/products/:id/blocks', async (req, res) => {
  const { id } = req.params;
  try {
    const blocks = await dbAll('SELECT * FROM blocks WHERE product_id = ? ORDER BY block_index ASC', [id]);
    res.json(blocks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Transfer product (Distributor, Warehouse, Retailer, Handoffs)
app.post('/api/products/:id/transfer', async (req, res) => {
  const { id } = req.params;
  const { actor, actorWalletAddress, location, action } = req.body;

  if (!actor || !actorWalletAddress || !location || !action) {
    return res.status(400).json({ error: 'Actor, Wallet, Location, and Action are required.' });
  }

  const timestamp = new Date().toISOString();

  try {
    // 1. Fetch Product
    const product = await dbGet('SELECT * FROM products WHERE id = ?', [id]);
    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    // 2. Check if product is already SOLD
    if (product.status === 'SOLD') {
      const details = `Illegal handoff attempt by ${actor} at ${location} (Wallet: ${actorWalletAddress}) on an already SOLD product.`;
      
      // Log Security Alert
      await dbRun(`
        INSERT INTO alerts (product_id, timestamp, location, actor_wallet_address, alert_type, details, is_resolved)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `, [id, timestamp, location, actorWalletAddress, 'SOLD_AND_SCANNED', details]);

      return res.status(400).json({
        counterfeit: true,
        error: 'TRANSFER_REJECTED_SOLD',
        message: 'This product has already been sold. Further supply chain transfers are disabled to prevent counterfeiting.'
      });
    }

    // 3. Fetch current blocks to calculate hashes
    const blocks = await dbAll('SELECT * FROM blocks WHERE product_id = ? ORDER BY block_index ASC', [id]);
    if (blocks.length === 0) {
      return res.status(400).json({ error: 'No ledger found for this product.' });
    }

    // Verify existing chain is clean before appending
    const integrityCheck = verifyChain(blocks);
    if (!integrityCheck.isValid) {
      const details = `Handoff attempt by ${actor} rejected. Existing database chain is corrupted: ${integrityCheck.reason}`;
      
      await dbRun(`
        INSERT INTO alerts (product_id, timestamp, location, actor_wallet_address, alert_type, details, is_resolved)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `, [id, timestamp, location, actorWalletAddress, 'CHAIN_BROKEN', details]);

      return res.status(400).json({
        counterfeit: true,
        error: 'CHAIN_TAMPERED',
        message: 'Ledger verification failed. Existing chain integrity is compromised. Action logged.'
      });
    }

    // 4. Create new block
    const lastBlock = blocks[blocks.length - 1];
    const previousHash = lastBlock.current_hash;
    const blockIndex = lastBlock.block_index + 1;

    const currentHash = calculateBlockHash({
      productId: id,
      previousHash,
      timestamp,
      actor,
      actorWalletAddress,
      location,
      action
    });

    // 5. Insert block into database
    await dbRun(`
      INSERT INTO blocks (product_id, block_index, previous_hash, timestamp, actor, actor_wallet_address, location, action, current_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, blockIndex, previousHash, timestamp, actor, actorWalletAddress, location, action, currentHash]);

    // 6. Update Product status based on actor/action
    let newStatus = 'IN_TRANSIT';
    if (action.toLowerCase().includes('sold') || action.toLowerCase().includes('customer')) {
      newStatus = 'SOLD';
    } else if (actor.toLowerCase().includes('distributor')) {
      newStatus = 'DISTRIBUTED';
    } else if (actor.toLowerCase().includes('warehouse')) {
      newStatus = 'WAREHOUSED';
    } else if (actor.toLowerCase().includes('retailer')) {
      newStatus = 'RETAILED';
    }

    await dbRun('UPDATE products SET status = ? WHERE id = ?', [newStatus, id]);

    res.json({
      message: 'Product transfer successfully recorded in ledger.',
      blockIndex,
      currentHash,
      newStatus
    });

  } catch (error) {
    console.error('Error performing product handoff:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Verify and Scan Product (Public verification page)
// Performs integrity check and logs alerts if a customer scans a sold product from a new location
app.post('/api/products/:id/verify', async (req, res) => {
  const { id } = req.params;
  const { scanLocation, scannerWallet } = req.body;

  const timestamp = new Date().toISOString();
  const location = scanLocation || 'Unknown Location';
  const wallet = scannerWallet || '0xCustomerPublicScan';

  try {
    const product = await dbGet('SELECT * FROM products WHERE id = ?', [id]);
    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const blocks = await dbAll('SELECT * FROM blocks WHERE product_id = ? ORDER BY block_index ASC', [id]);
    if (blocks.length === 0) {
      return res.status(400).json({ error: 'Chain blocks not found.' });
    }

    // 1. Recalculate block-by-block integrity
    const integrityCheck = verifyChain(blocks);
    if (!integrityCheck.isValid) {
      // Log alert if not already logged
      const details = `Broken hash chain detected on customer scan for product ${id}. Recalculation failed: ${integrityCheck.reason}`;
      
      const existingAlert = await dbGet(
        "SELECT * FROM alerts WHERE product_id = ? AND alert_type = 'CHAIN_BROKEN' AND is_resolved = 0",
        [id]
      );
      if (!existingAlert) {
        await dbRun(`
          INSERT INTO alerts (product_id, timestamp, location, actor_wallet_address, alert_type, details, is_resolved)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `, [id, timestamp, location, wallet, 'CHAIN_BROKEN', details]);
      }

      return res.json({
        isValid: false,
        reason: 'CHAIN_BROKEN',
        message: 'DATABASE INTEGRITY FAILURE: The blockchain hash links have been modified or corrupted.',
        details: integrityCheck.reason,
        product,
        blocks
      });
    }

    // 2. Check if product is sold and scanned from another location
    if (product.status === 'SOLD') {
      const lastBlock = blocks[blocks.length - 1];

      // If location is different or wallet is different from the sale record
      if (lastBlock.location.toLowerCase() !== location.toLowerCase()) {
        const details = `Duplicate scan detected. Product already sold in ${lastBlock.location} on ${new Date(lastBlock.timestamp).toLocaleDateString()}. New scan originated from ${location} by wallet ${wallet}. Possible clone.`;
        
        // Log counterfeit alert
        await dbRun(`
          INSERT INTO alerts (product_id, timestamp, location, actor_wallet_address, alert_type, details, is_resolved)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `, [id, timestamp, location, wallet, 'SOLD_AND_SCANNED', details]);

        return res.json({
          isValid: false,
          reason: 'SOLD_AND_SCANNED',
          message: 'POSSIBLE COUNTERFEIT / DUPLICATE PRODUCT DETECTED',
          details: `This unique product identifier was already marked as SOLD in ${lastBlock.location} on ${new Date(lastBlock.timestamp).toLocaleDateString()}. This secondary scan occurred in ${location}, representing a duplicate or cloned QR code.`,
          product,
          blocks,
          lastSoldBlock: lastBlock
        });
      }
    }

    // All clean
    res.json({
      isValid: true,
      message: 'AUTHENTIC — CHAIN VERIFIED',
      product,
      blocks
    });

  } catch (error) {
    console.error('Error verifying product:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. Get all alerts for Admin panel
app.get('/api/alerts', async (req, res) => {
  try {
    const alerts = await dbAll('SELECT * FROM alerts ORDER BY timestamp DESC');
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Resolve an alert
app.post('/api/alerts/:id/resolve', async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('UPDATE alerts SET is_resolved = 1 WHERE id = ?', [id]);
    res.json({ message: 'Alert marked as resolved.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Get overall stats for Admin dashboard
app.get('/api/stats', async (req, res) => {
  try {
    const productsCount = await dbGet('SELECT COUNT(*) as count FROM products');
    const transfersCount = await dbGet('SELECT COUNT(*) as count FROM blocks');
    const alertsCount = await dbGet('SELECT COUNT(*) as count FROM alerts WHERE is_resolved = 0');
    
    const categoryStats = await dbAll('SELECT category, COUNT(*) as count FROM products GROUP BY category');
    const statusStats = await dbAll('SELECT status, COUNT(*) as count FROM products GROUP BY status');

    res.json({
      totalProducts: productsCount.count,
      totalTransfers: transfersCount.count,
      activeAlerts: alertsCount.count,
      categoryStats,
      statusStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`TrustChain backend running at http://localhost:${PORT}`);
});
