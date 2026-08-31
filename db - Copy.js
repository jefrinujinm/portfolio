import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateBlockHash } from './blockchain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'trustchain.db');
const db = new sqlite3.Database(dbPath);

// Promisified Database Helpers
export const dbRun = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

export const dbGet = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Initialize database schema and seed data
export async function initDb() {
  console.log('Initializing SQLite Database...');

  // Create tables
  await dbRun(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      batch_number TEXT NOT NULL,
      manufacturing_date TEXT NOT NULL,
      category TEXT NOT NULL,
      manufacturing_location TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      block_index INTEGER NOT NULL,
      previous_hash TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_wallet_address TEXT NOT NULL,
      location TEXT NOT NULL,
      action TEXT NOT NULL,
      current_hash TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      location TEXT NOT NULL,
      actor_wallet_address TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      details TEXT NOT NULL,
      is_resolved INTEGER DEFAULT 0
    )
  `);

  // Check if seeding is needed
  const countRow = await dbGet('SELECT COUNT(*) as count FROM products');
  if (countRow.count === 0) {
    console.log('Database empty. Seeding demo data...');
    await seedData();
  } else {
    console.log('Database already initialized with data.');
  }
}

async function seedData() {
  // --- 1. Product A: Clean Supply Chain Product ---
  const cleanId = 'clean-amox-908';
  await dbRun(`
    INSERT INTO products (id, name, batch_number, manufacturing_date, category, manufacturing_location, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    cleanId,
    'Apex Amoxicillin',
    'AMX-908',
    '2026-08-01',
    'Medicine',
    'San Francisco, CA',
    'SOLD',
    '2026-08-01T08:00:00.000Z'
  ]);

  // Clean steps
  const cleanSteps = [
    {
      actor: 'Manufacturer (Apex Pharma)',
      wallet: '0xManuf11111111111111111111111111111111111',
      location: 'San Francisco, CA',
      action: 'Registered product & created Genesis Block',
      time: '2026-08-01T08:00:00.000Z'
    },
    {
      actor: 'Distributor (Logistics Pro)',
      wallet: '0xDist22222222222222222222222222222222222',
      location: 'Oakland, CA',
      action: 'Received and dispatched to Chicago',
      time: '2026-08-03T10:30:00.000Z'
    },
    {
      actor: 'Warehouse (Midwest Hub)',
      wallet: '0xWare33333333333333333333333333333333333',
      location: 'Chicago, IL',
      action: 'Received, inspected, and stored in cold unit',
      time: '2026-08-05T14:15:00.000Z'
    },
    {
      actor: 'Retailer (PharmaCare NY)',
      wallet: '0xReta44444444444444444444444444444444444',
      location: 'New York, NY',
      action: 'Received at retail store and stocked on shelf',
      time: '2026-08-08T09:00:00.000Z'
    },
    {
      actor: 'Retailer (PharmaCare NY)',
      wallet: '0xReta44444444444444444444444444444444444',
      location: 'New York, NY',
      action: 'Sold to Customer (Product chain closed)',
      time: '2026-08-10T16:45:00.000Z'
    }
  ];

  let prevHash = '0';
  for (let i = 0; i < cleanSteps.length; i++) {
    const step = cleanSteps[i];
    const currentHash = calculateBlockHash({
      productId: cleanId,
      previousHash: prevHash,
      timestamp: step.time,
      actor: step.actor,
      actorWalletAddress: step.wallet,
      location: step.location,
      action: step.action
    });

    await dbRun(`
      INSERT INTO blocks (product_id, block_index, previous_hash, timestamp, actor, actor_wallet_address, location, action, current_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [cleanId, i, prevHash, step.time, step.actor, step.wallet, step.location, step.action, currentHash]);

    prevHash = currentHash;
  }

  // --- 2. Product B: Tampered Ledger Product ---
  const tamperedId = 'tampered-apples-402';
  await dbRun(`
    INSERT INTO products (id, name, batch_number, manufacturing_date, category, manufacturing_location, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    tamperedId,
    'BioFruits Organic Apples',
    'BFO-402',
    '2026-08-12',
    'Food',
    'Yakima, WA',
    'DISTRIBUTED',
    '2026-08-12T09:00:00.000Z'
  ]);

  const tamperedSteps = [
    {
      actor: 'Manufacturer (BioFruits Growers)',
      wallet: '0xManuf11111111111111111111111111111111111',
      location: 'Yakima, WA',
      action: 'Registered product & created Genesis Block',
      time: '2026-08-12T09:00:00.000Z'
    },
    {
      actor: 'Distributor (Organic Transit)',
      wallet: '0xDist22222222222222222222222222222222222',
      location: 'Seattle, WA',
      action: 'Received and loaded onto delivery vans',
      time: '2026-08-14T11:00:00.000Z'
    }
  ];

  prevHash = '0';
  for (let i = 0; i < tamperedSteps.length; i++) {
    const step = tamperedSteps[i];
    let currentHash = calculateBlockHash({
      productId: tamperedId,
      previousHash: prevHash,
      timestamp: step.time,
      actor: step.actor,
      actorWalletAddress: step.wallet,
      location: step.location,
      action: step.action
    });

    // Manually tamper with the distributor block hash in DB
    if (i === 1) {
      currentHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855_tampered';
    }

    await dbRun(`
      INSERT INTO blocks (product_id, block_index, previous_hash, timestamp, actor, actor_wallet_address, location, action, current_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [tamperedId, i, prevHash, step.time, step.actor, step.wallet, step.location, step.action, currentHash]);

    prevHash = currentHash;
  }

  // --- 3. Product C: Legitimate sold product + Logged counterfeit alert ---
  const counterfeitId = 'counterfeit-chip-777';
  await dbRun(`
    INSERT INTO products (id, name, batch_number, manufacturing_date, category, manufacturing_location, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    counterfeitId,
    'Quantum Microchips 5G',
    'QMC-777',
    '2026-08-15',
    'Electronics',
    'Austin, TX',
    'SOLD',
    '2026-08-15T10:00:00.000Z'
  ]);

  const counterfeitSteps = [
    {
      actor: 'Manufacturer (Quantum Foundry)',
      wallet: '0xManuf55555555555555555555555555555555555',
      location: 'Austin, TX',
      action: 'Registered product & created Genesis Block',
      time: '2026-08-15T10:00:00.000Z'
    },
    {
      actor: 'Distributor (Global Express)',
      wallet: '0xDist66666666666666666666666666666666666',
      location: 'Dallas, TX',
      action: 'Received and sorted',
      time: '2026-08-17T12:00:00.000Z'
    },
    {
      actor: 'Retailer (ElectroStore NYC)',
      wallet: '0xReta77777777777777777777777777777777777',
      location: 'New York, NY',
      action: 'Sold to Customer (Retail verification closed)',
      time: '2026-08-20T15:30:00.000Z'
    }
  ];

  prevHash = '0';
  for (let i = 0; i < counterfeitSteps.length; i++) {
    const step = counterfeitSteps[i];
    const currentHash = calculateBlockHash({
      productId: counterfeitId,
      previousHash: prevHash,
      timestamp: step.time,
      actor: step.actor,
      actorWalletAddress: step.wallet,
      location: step.location,
      action: step.action
    });

    await dbRun(`
      INSERT INTO blocks (product_id, block_index, previous_hash, timestamp, actor, actor_wallet_address, location, action, current_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [counterfeitId, i, prevHash, step.time, step.actor, step.wallet, step.location, step.action, currentHash]);

    prevHash = currentHash;
  }

  // Add the mock security alert for a subsequent clone attempt
  await dbRun(`
    INSERT INTO alerts (product_id, timestamp, location, actor_wallet_address, alert_type, details, is_resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    counterfeitId,
    '2026-08-22T14:10:00.000Z',
    'Miami, FL',
    '0xFake99999999999999999999999999999999999',
    'SOLD_AND_SCANNED',
    'Scan/Handoff attempt at Miami, FL by wallet 0xFake9999... rejected. Product status is already SOLD (legitimately sold in New York, NY on 2026-08-20). Possible cloned QR code.',
    0
  ]);

  console.log('Demo data successfully seeded.');
}
export default db;
