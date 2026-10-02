require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'faga_production_secure_token_secret_key';

app.use(express.json());

// 🗄️ Core PostgreSQL Database Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') 
    ? false 
    : { rejectUnauthorized: false } // Auto-enables secure SSL for production hosting like Railway
});

// 🚀 AUTOMATED TABLE GENERATION ENGINE (Runs on Boot)
const initDatabase = async () => {
  const schemaQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'customer',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS addresses (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      address_line VARCHAR(255) NOT NULL,
      city VARCHAR(100) NOT NULL,
      is_default BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id SERIAL PRIMARY KEY,
      customer_id INT REFERENCES users(id) ON DELETE CASCADE,
      rider_id INT REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(50) DEFAULT 'PENDING',
      pickup_address TEXT NOT NULL,
      dropoff_address TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS telemetries (
      id SERIAL PRIMARY KEY,
      delivery_id INT REFERENCES deliveries(id) ON DELETE CASCADE,
      latitude NUMERIC(10, 8) NOT NULL,
      longitude NUMERIC(11, 8) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rider_applications (
      id SERIAL PRIMARY KEY,
      user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

        CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      balance NUMERIC(12, 2) DEFAULT 0.00,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      wallet_id INT REFERENCES wallets(id) ON DELETE CASCADE,
      amount NUMERIC(12, 2) NOT NULL,
      type VARCHAR(50) NOT NULL, -- 'DEPOSIT', 'WITHDRAWAL', 'PAYMENT'
      status VARCHAR(50) DEFAULT 'COMPLETED', -- 'PENDING', 'COMPLETED', 'FAILED'
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

        CREATE TABLE IF NOT EXISTS seller_applications (
      id SERIAL PRIMARY KEY,
      user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      store_name VARCHAR(255) NOT NULL,
      business_address TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'under_review', 'approved', 'rejected'
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS seller_profiles (
      id SERIAL PRIMARY KEY,
      user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      store_name VARCHAR(255) NOT NULL,
      business_address TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'open', -- 'open', 'closed'
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );


  `;
  try {
    await pool.query(schemaQuery);
    console.log("FAGA Production Database tables initialized successfully. 🗄️");
  } catch (err) {
    console.error("Critical failure configuring database layout on boot:", err.message);
  }
};
initDatabase();

// 🔐 Authentication Guard (Replaces Laravel's auth:sanctum middleware)
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract token after 'Bearer'

  if (!token) return res.status(401).json({ message: 'Unauthorized access: Session token missing.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userQuery = await pool.query('SELECT id, name, email, role, is_active FROM users WHERE id = $1', [decoded.id]);
    
    if (userQuery.rows.length === 0) {
      return res.status(403).json({ message: 'Access forbidden: Suspended or invalid user accounts.' });
    }

    const user = userQuery.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ message: 'Access forbidden: Suspended or invalid user accounts.' });
    }
    
    // Pass user metadata down to subsequent controllers safely
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.is_active
    };
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Invalid or expired session parameters.' });
  }
};

// 🛡️ Role Enforcement Guard (Replaces Laravel's EnsureUserHasRole middleware)
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access forbidden: Insufficient access privileges.' });
    }
    next();
  };
};

// ==========================================
// PUBLIC AUTHENTICATION ENDPOINTS
// ==========================================
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, role',
      [name, email, hashedPassword]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token });
  } catch (error) {
    res.status(400).json({ error: 'This email account is already registered.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid authentication credentials provided.' });
    }

    const user = result.rows[0];
    if (!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid authentication credentials provided.' });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SECURED ROUTING PIPELINE (Requires Authentication Guard)
// ==========================================
app.use('/api', authenticateToken);

// Customer Profile Logic
app.get('/api/profile', (req, res) => {
  res.json(req.user);
});

app.patch('/api/profile', async (req, res) => {
  const fields = Object.keys(req.body);
  const values = Object.values(req.body);
  if (fields.length === 0) return res.status(400).json({ error: 'No update data provided.' });

  // Dynamically map updates array indices to prevent SQL injection loops
  const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
  values.push(req.user.id);

  try {
    const result = await pool.query(
      `UPDATE users SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${fields.length + 1} RETURNING id, name, email, role`,
      values
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Customer Address Management
app.get('/api/addresses', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, address_line AS "addressLine", city, is_default AS "isDefault" FROM addresses WHERE user_id = $1', [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/addresses', async (req, res) => {
  const { addressLine, city } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO addresses (user_id, address_line, city) VALUES ($1, $2, $3) RETURNING id, address_line AS "addressLine", city, is_default AS "isDefault"',
      [req.user.id, addressLine, city]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/addresses/:id/default', async (req, res) => {
  const addressId = parseInt(req.params.id);
  try {
    await pool.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
    const result = await pool.query(
      'UPDATE addresses SET is_default = true WHERE id = $1 AND user_id = $2 RETURNING id, address_line AS "addressLine", city, is_default AS "isDefault"',
      [addressId, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Logistics & Deliveries Engine
app.post('/api/deliveries', async (req, res) => {
  const { pickupAddress, dropoffAddress } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO deliveries (customer_id, pickup_address, dropoff_address) VALUES ($1, $2, $3) RETURNING id, customer_id AS "customerId", status, pickup_address AS "pickupAddress", dropoff_address AS "dropoffAddress"',
      [req.user.id, pickupAddress, dropoffAddress]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/deliveries', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, customer_id AS "customerId", rider_id AS "riderId", status, pickup_address AS "pickupAddress", dropoff_address AS "dropoffAddress" FROM deliveries WHERE customer_id = $1',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/deliveries/:id/assign-rider', authorizeRoles('admin'), async (req, res) => {
  const { riderId } = req.body;
  const deliveryId = parseInt(req.params.id);
  try {
    const result = await pool.query(
      'UPDATE deliveries SET rider_id = $1, status = \'ASSIGNED\' WHERE id = $2 RETURNING id, customer_id AS "customerId", rider_id AS "riderId", status, pickup_address AS "pickupAddress", dropoff_address AS "dropoffAddress"',
      [parseInt(riderId), deliveryId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// LIVE DRIVER GEOLOCATION TELEMETRY PATHWAY
// ==========================================
app.post('/api/telemetry/update', authorizeRoles('rider', 'admin'), async (req, res) => {
const { ride_id, latitude, longitude } = req.body;
try {
const result = await pool.query(
'INSERT INTO telemetries (delivery_id, latitude, longitude) VALUES ($1, $2, $3) RETURNING id, delivery_id AS "deliveryId", latitude, longitude',
[parseInt(ride_id), parseFloat(latitude), parseFloat(longitude)]
);
res.json({ success: true, message: 'Coordinates buffered successfully.', data: result.rows[0] });
} catch (error) {
res.status(400).json({ error: 'Failed to stream location metrics to data buffers.' });
}
});
// Admin Applications Decision Logic (Riders)
app.post('/api/admin/rider-applications/:id/approve', authorizeRoles('admin'), async (req, res) => {
const appId = parseInt(req.params.id);
try {
const appUpdate = await pool.query(
"UPDATE rider_applications SET status = 'approved' WHERE id = $1 RETURNING user_id",
[appId]
);
if (appUpdate.rows.length === 0) return res.status(404).json({ error: 'Application entry not found.' });
const targetUserId = appUpdate.rows[0].user_id;
await pool.query("UPDATE users SET role = 'rider' WHERE id = $1", [targetUserId]);
res.json({ message: 'Rider application processed and profile role elevated successfully.' });
} catch (error) {
res.status(400).json({ error: error.message });
}
});
// ==========================================
// FINANCIAL & WALLET LEDGER ENDPOINTS
// ==========================================

// 1. Get Wallet Balance & Transaction History
app.get('/api/finance/wallet', async (req, res) => {
  try {
    // Check if wallet exists, if not, create one automatically for the user
    let walletQuery = await pool.query('SELECT id, balance FROM wallets WHERE user_id = $1', [req.user.id]);
    
    if (walletQuery.rows.length === 0) {
      walletQuery = await pool.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0.00) RETURNING id, balance', [req.user.id]);
    }
    
    const wallet = walletQuery.rows[0];
    
    // Fetch recent transactions
    const txQuery = await pool.query(
      'SELECT id, amount, type, status, description, created_at AS "createdAt" FROM transactions WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT 20',
      [wallet.id]
    );

    res.json({
      balance: parseFloat(wallet.balance),
      transactions: txQuery.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Fund Wallet / Process Deposit
app.post('/api/finance/deposit', async (req, res) => {
  const { amount, description } = req.body;
  
  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Invalid deposit amount.' });
  }

  try {
    // Get user wallet
    let walletQuery = await pool.query('SELECT id FROM wallets WHERE user_id = $1', [req.user.id]);
    if (walletQuery.rows.length === 0) {
      walletQuery = await pool.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0.00) RETURNING id', [req.user.id]);
    }
    const walletId = walletQuery.rows[0].id;

    // Run wallet update and transaction insert as a single safe database block
    await pool.query('BEGIN');
    
    await pool.query('UPDATE wallets SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [parseFloat(amount), walletId]);
    
    const txResult = await pool.query(
      'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, \'DEPOSIT\', $3) RETURNING id, amount, type, status, created_at AS "createdAt"',
      [walletId, parseFloat(amount), description || 'Wallet Funding']
    );

    await pool.query('COMMIT');
    res.status(201).json({ message: 'Wallet funded successfully.', transaction: txResult.rows[0] });
  } catch (error) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  }
});
// ==========================================
// SELLER APPLICATION MANAGEMENT SYSTEM
// ==========================================

// 1. Submit a Seller Application (Me)
app.post('/api/seller-applications', async (req, res) => {
  const { storeName, businessAddress } = req.body;
  if (!storeName || !businessAddress) {
    return res.status(400).json({ error: 'Store name and business address are required parameters.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO seller_applications (user_id, store_name, business_address) VALUES ($1, $2, $3) RETURNING id, user_id AS "userId", store_name AS "storeName", status, created_at AS "createdAt"',
      [req.user.id, storeName, businessAddress]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(400).json({ error: 'You have already submitted an active seller application.' });
  }
});

// 2. Fetch My Seller Application Status
app.get('/api/seller-applications/me', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, store_name AS "storeName", business_address AS "businessAddress", status, created_at AS "createdAt" FROM seller_applications WHERE user_id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'No seller application profiles found.' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Admin: List All Global Seller Applications
app.get('/api/admin/seller-applications', authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, user_id AS "userId", store_name AS "storeName", business_address AS "businessAddress", status, created_at AS "createdAt" FROM seller_applications ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Admin: Approve a Seller Application (Elevates User Role to 'seller')
app.post('/api/admin/seller-applications/:id/approve', authorizeRoles('admin'), async (req, res) => {
  const appId = parseInt(req.params.id);
  try {
    await pool.query('BEGIN');
    
    const appUpdate = await pool.query(
      "UPDATE seller_applications SET status = 'approved' WHERE id = $1 RETURNING user_id, store_name, business_address",
      [appId]
    );
    
    if (appUpdate.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Seller application entry not found.' });
    }

    const appData = appUpdate.rows[0];
    
    // Elevate user system access level
    await pool.query("UPDATE users SET role = 'seller' WHERE id = $1", [appData.user_id]);
    
    // Provision vendor production profile card
    await pool.query(
      'INSERT INTO seller_profiles (user_id, store_name, business_address) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING',
      [appData.user_id, appData.store_name, appData.business_address]
    );

    await pool.query('COMMIT');
    res.json({ message: 'Seller application approved. User profile role successfully elevated to seller.' });
  } catch (error) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  }
});


// ==========================================
// OPEN JOB BOARD MANAGER PIPELINE
// ==========================================

// 1. Public List Open Job Postings
app.get('/api/jobs', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, title, description, status, created_at AS "createdAt" FROM jobs WHERE status = \'open\' ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Public View Specific Job Context Item
app.get('/api/jobs/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, title, description, status, created_at AS "createdAt" FROM jobs WHERE id = $1', [parseInt(req.params.id)]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Requested job posting profile not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Staff Enforcement: Post New Employment Openings
app.post('/api/jobs', authorizeRoles('admin'), async (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) return res.status(400).json({ error: 'Job title and description payload arrays are required.' });

  try {
    const result = await pool.query(
      'INSERT INTO jobs (title, description) VALUES ($1, $2) RETURNING id, title, description, status, created_at AS "createdAt"',
      [title, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Staff Enforcement: Toggle/Close Job Board Visibility
app.patch('/api/jobs/:id/close', authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE jobs SET status = 'closed' WHERE id = $1 RETURNING id, title, status",
      [parseInt(req.params.id)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Target job item reference not found.' });
    res.json({ message: 'Job entry marked closed successfully.', job: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.listen(PORT, () => console.log(`FAGA Pure Node Engine streaming live on port ${PORT} 🚀`));