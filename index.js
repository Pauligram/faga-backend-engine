require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET;

// Never start with a known or empty signing secret. Configure a unique
// secret in Railway Variables and in a local, uncommitted .env file.
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET is required and must be at least 32 characters. Configure it in the deployment environment.');
}

// ==========================================
// CORS AND BASIC SECURITY HEADERS
// ==========================================

const defaultDevelopmentOrigins = [
  'http://localhost:5501',
  'http://127.0.0.1:5501',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];
const configuredOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
  .map(value => {
    try { return new URL(value).origin; }
    catch { return null; }
  })
  .filter(Boolean);
const allowedOrigins = new Set(
  configuredOrigins.length
    ? configuredOrigins
    : (NODE_ENV === 'production' ? [] : defaultDevelopmentOrigins)
);

if (NODE_ENV === 'production' && allowedOrigins.size === 0) {
  throw new Error('FRONTEND_URL must contain the exact HTTPS origin(s) allowed to access the FAGA API. Multiple origins may be comma-separated.');
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self)');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  if (req.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return res.sendStatus(403);
    return res.sendStatus(204);
  }
  next();
});

// Keep request bodies bounded to reduce abuse from oversized JSON payloads.
app.use(express.json({ limit: '1mb' }));

// ==========================================
// HEALTH CHECK
// ==========================================

// Railway / browser health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'FAGA Backend Engine',
    status: 'online'
  });
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ success: true, status: 'online', database: 'connected' });
  } catch (error) {
    console.error('FAGA readiness check failed:', error.message);
    return res.status(503).json({ success: false, status: 'degraded', database: 'unavailable' });
  }
});

// ==========================================
// 🗄️ FAGA POSTGRESQL DATABASE CONNECTION
// ==========================================

// Local development should use DATABASE_PUBLIC_URL.
// Railway production can continue using DATABASE_URL.
const databaseUrl =
  process.env.DATABASE_PUBLIC_URL ||
  process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'FAGA database configuration missing. Set DATABASE_PUBLIC_URL locally or DATABASE_URL on Railway.'
  );
}

// Railway private hostname cannot be reached from a local Windows PC.
if (
  !process.env.RAILWAY_ENVIRONMENT &&
  databaseUrl.includes('railway.internal')
) {
  throw new Error(
    'Local FAGA development is using Railway private database host "postgres.railway.internal". ' +
    'Set DATABASE_PUBLIC_URL to the Railway public PostgreSQL connection string.'
  );
}

const isLocalDatabase =
  databaseUrl.includes('localhost') ||
  databaseUrl.includes('127.0.0.1');

const pool = new Pool({
  connectionString: databaseUrl,

  // Local PostgreSQL normally does not require SSL.
  // Railway public PostgreSQL requires SSL.
  ssl: isLocalDatabase
    ? false
    : {
        rejectUnauthorized: false
      },

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Test the database connection when the application starts.
pool.on('error', (error) => {
  console.error('FAGA PostgreSQL pool error:', error.message);
});

// ==========================================
// FAGA RIDE SCHEMA UPGRADE
// ==========================================
// The rides table already exists.
// Add the fields required by the live Ride API
// without deleting existing ride data.

const fagaRideSchema = `

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS tracking_token VARCHAR(64),
  ADD COLUMN IF NOT EXISTS distance_km NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS duration_minutes INT,
  ADD COLUMN IF NOT EXISTS driver_eta_minutes INT,
  ADD COLUMN IF NOT EXISTS estimated_arrival_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS route_geometry JSONB,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;


  CREATE UNIQUE INDEX IF NOT EXISTS rides_tracking_token_unique_idx
    ON rides(tracking_token)
    WHERE tracking_token IS NOT NULL;

  CREATE INDEX IF NOT EXISTS rides_customer_idx
    ON rides(customer_id);

  CREATE INDEX IF NOT EXISTS rides_driver_idx
    ON rides(driver_id);

  CREATE INDEX IF NOT EXISTS rides_status_idx
    ON rides(status);

  CREATE INDEX IF NOT EXISTS ride_locations_ride_idx
    ON ride_locations(ride_id, created_at DESC);

    ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rider_available BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS users_rider_available_idx
  ON users(rider_available);
`;

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

    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

    CREATE TABLE IF NOT EXISTS admin_accounts (
      id SERIAL PRIMARY KEY,
      user_id INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      admin_role VARCHAR(50) NOT NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
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

      customer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rider_id INT REFERENCES users(id) ON DELETE SET NULL,

      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',

      pickup_address TEXT NOT NULL,
      pickup_latitude NUMERIC(10, 8),
      pickup_longitude NUMERIC(11, 8),

      dropoff_address TEXT NOT NULL,
      dropoff_latitude NUMERIC(10, 8),
      dropoff_longitude NUMERIC(11, 8),

      package_description TEXT,
      package_type VARCHAR(100),
      package_weight NUMERIC(10, 2),

      recipient_name VARCHAR(255),
      recipient_phone VARCHAR(50),

      distance_km NUMERIC(10, 2),
      delivery_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      accepted_at TIMESTAMP,
      picked_up_at TIMESTAMP,
      delivered_at TIMESTAMP,
      cancelled_at TIMESTAMP,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS delivery_matches (
      id SERIAL PRIMARY KEY,

      delivery_id INT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
      rider_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      status VARCHAR(50) NOT NULL DEFAULT 'OFFERED',

      offered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      responded_at TIMESTAMP,

      UNIQUE(delivery_id, rider_id)
    );

    -- Upgrade existing deliveries table safely
    ALTER TABLE deliveries
      ADD COLUMN IF NOT EXISTS pickup_latitude NUMERIC(10, 8),
      ADD COLUMN IF NOT EXISTS pickup_longitude NUMERIC(11, 8),
      ADD COLUMN IF NOT EXISTS dropoff_latitude NUMERIC(10, 8),
      ADD COLUMN IF NOT EXISTS dropoff_longitude NUMERIC(11, 8),
      ADD COLUMN IF NOT EXISTS package_description TEXT,
      ADD COLUMN IF NOT EXISTS package_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS package_weight NUMERIC(10, 2),
      ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS distance_km NUMERIC(10, 2),
      ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(12, 2) DEFAULT 0.00,
      ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

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
      type VARCHAR(50) NOT NULL,
      status VARCHAR(50) DEFAULT 'COMPLETED',
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(50),
      ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_payment_reference
      ON transactions(payment_provider, payment_reference)
      WHERE payment_reference IS NOT NULL;

    CREATE TABLE IF NOT EXISTS seller_applications (
      id SERIAL PRIMARY KEY,
      user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      store_name VARCHAR(255) NOT NULL,
      business_address TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
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
      status VARCHAR(50) DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rides (
      id SERIAL PRIMARY KEY,

      customer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      driver_id INT REFERENCES users(id) ON DELETE SET NULL,

      pickup_address TEXT NOT NULL,
      pickup_latitude NUMERIC(10, 8),
      pickup_longitude NUMERIC(11, 8),

      destination_address TEXT NOT NULL,
      destination_latitude NUMERIC(10, 8),
      destination_longitude NUMERIC(11, 8),

      ride_type VARCHAR(50) NOT NULL DEFAULT 'economy',
      passengers INT NOT NULL DEFAULT 1,

      fare NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      status VARCHAR(50) NOT NULL DEFAULT 'REQUESTED',

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ride_locations (
      id SERIAL PRIMARY KEY,
      ride_id INT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
      latitude NUMERIC(10, 8) NOT NULL,
      longitude NUMERIC(11, 8) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(schemaQuery);
    await pool.query(fagaRideSchema);

    console.log(
      'FAGA Production Database tables initialized successfully. 🗄'
    );
  } catch (err) {
    console.error(
      'Critical failure configuring database layout on boot:',
      err.message
    );

    throw err;
  }
};

// ==========================================
// INITIAL SUPER ADMIN BOOTSTRAP
// ==========================================

const bootstrapSuperAdmin = async () => {
  const email = process.env.FAGA_SUPER_ADMIN_EMAIL;
  const password = process.env.FAGA_SUPER_ADMIN_PASSWORD;
  const enabled =
    process.env.FAGA_SUPER_ADMIN_BOOTSTRAP === 'true';

  if (!enabled) {
    return;
  }

  if (!email || !password) {
    throw new Error(
      'FAGA_SUPER_ADMIN_EMAIL and FAGA_SUPER_ADMIN_PASSWORD are required when Super Admin bootstrap is enabled.'
    );
  }

  try {
    const existingUser = await pool.query(
      'SELECT id, role, is_active FROM users WHERE email = $1',
      [email]
    );

    let user;

    if (existingUser.rows.length === 0) {
      const hashedPassword =
        await bcrypt.hash(password, 12);

      const result = await pool.query(
        `
        INSERT INTO users (
          name,
          email,
          password,
          role,
          is_active
        )
        VALUES ($1, $2, $3, 'super_admin', true)
        RETURNING id, name, email, role, is_active
        `,
        [
          'FAGA Super Administrator',
          email,
          hashedPassword
        ]
      );

      user = result.rows[0];

      console.log(
        `Super Admin account created: ${email}`
      );
    } else {
      user = existingUser.rows[0];

      if (
        user.role !== 'super_admin' ||
        !user.is_active
      ) {
        await pool.query(
          `
          UPDATE users
          SET
            role = 'super_admin',
            is_active = true,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          `,
          [user.id]
        );

        user.role = 'super_admin';
        user.is_active = true;

        console.log(
          `Existing account elevated to Super Admin: ${email}`
        );
      }
    }

    await pool.query(
      `
      INSERT INTO admin_accounts (
        user_id,
        admin_role,
        created_by,
        is_active
      )
      VALUES ($1, 'super_admin', NULL, true)
      ON CONFLICT (user_id)
      DO UPDATE SET
        admin_role = 'super_admin',
        is_active = true,
        updated_at = CURRENT_TIMESTAMP
      `,
      [user.id]
    );

    console.log(
      `Super Admin bootstrap completed for ${email}`
    );
  } catch (error) {
    console.error(
      'Super Admin bootstrap failed:',
      error.message
    );

    throw error;
  }
};

// ==========================================
// DATABASE STARTUP SEQUENCE
// ==========================================

const startDatabase = async () => {
  try {
    await initDatabase();
    await bootstrapSuperAdmin();

    console.log(
      'FAGA database startup sequence completed successfully.'
    );
  } catch (error) {
    console.error(
      'FAGA startup initialization failed:',
      error.message
    );

    process.exit(1);
  }
};

// ==========================================
// AUTHENTICATION GUARD
// ==========================================

const authenticateToken = async (
  req,
  res,
  next
) => {

  // Public job-board GET requests do not require authentication.
  // These routes are still protected for POST/PATCH operations.
  if (
    req.method === 'GET' &&
    (
      req.path === '/jobs' ||
      /^\/jobs\/\d+$/.test(req.path)
    )
  ) {
    return next();
  }

  const authHeader =
    req.headers['authorization'];

  // Expected format:
  // Authorization: Bearer YOUR_TOKEN
  const token =
    authHeader &&
    authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;

  if (!token) {
    return res.status(401).json({
      message:
        'Unauthorized access: Session token missing.'
    });
  }

  try {
    const decoded =
      jwt.verify(token, JWT_SECRET);

    const userResult =
      await pool.query(
        `
        SELECT
          id,
          name,
          email,
          phone,
          role,
          is_active
        FROM users
        WHERE id = $1
        LIMIT 1
        `,
        [decoded.id]
      );

    if (
      !userResult.rows.length
    ) {
      return res.status(401).json({
        message:
          'Unauthorized access: User account not found.'
      });
    }

    const user =
      userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        message:
          'This user account is currently inactive.'
      });
    }

    req.user = user;

    next();

  } catch (error) {

    console.error(
      'Authentication error:',
      error.message
    );

    return res.status(401).json({
      message:
        'Unauthorized access: Invalid or expired session.'
    });
  }
};

// ==========================================
// AUTH ROUTES
// ==========================================

// LOGIN
app.post('/api/login', async (req, res) => {

  const {
    email,
    password
  } = req.body;

  if (
    typeof email !== 'string' || !email.trim() ||
    typeof password !== 'string' || !password ||
    email.length > 254 || Buffer.byteLength(password, 'utf8') > 72
  ) {
    return res.status(422).json({
      message: 'A valid email and password are required.'
    });
  }

  try {

    const result =
      await pool.query(
        `
        SELECT
          id,
          name,
          email,
          password,
          role,
          is_active
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        `,
        [email.trim()]
      );

    if (!result.rows.length) {
      return res.status(401).json({
        message:
          'Invalid authentication credentials.'
      });
    }

    const user =
      result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        message:
          'Your account is currently inactive.'
      });
    }

    const passwordMatches =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!passwordMatches) {
      return res.status(401).json({
        message:
          'Invalid authentication credentials.'
      });
    }

    const token =
      jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role
        },
        JWT_SECRET,
        {
          expiresIn: '7d'
        }
      );

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {

    console.error(
      'Login error:',
      error
    );

    return res.status(500).json({
      message:
        'Unable to process login right now.'
    });
  }
});

// ==========================================
// REGISTER
// ==========================================

app.post('/api/register', async (req, res) => {

  const {
    name,
    email,
    password,
    phone = ''
  } = req.body;

  if (
    typeof name !== 'string' || !name.trim() ||
    typeof email !== 'string' || !email.trim() ||
    typeof password !== 'string' || !password
  ) {
    return res.status(422).json({
      message: 'Name, email and password are required.'
    });
  }

  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(422).json({
      message: 'Password must be at least 8 characters and no more than 72 UTF-8 bytes.'
    });
  }

  if (name.trim().length > 255 || email.trim().length > 254 || String(phone || '').trim().length > 50) {
    return res.status(422).json({ message: 'One or more registration fields exceed the allowed length.' });
  }

  const normalizedEmail =
    email.trim().toLowerCase();

  try {

    const existing =
      await pool.query(
        `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        `,
        [normalizedEmail]
      );

    if (existing.rows.length) {
      return res.status(409).json({
        message:
          'An account with this email already exists.'
      });
    }

    // Public self-registration always creates a customer account. Rider and seller roles are granted only through approved workflows.
    const normalizedRole = 'customer';

    const hashedPassword =
      await bcrypt.hash(
        password,
        12
      );

    const result =
      await pool.query(
        `
        INSERT INTO users (
          name,
          email,
          phone,
          password,
          role,
          is_active
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          true
        )
        RETURNING
          id,
          name,
          email,
          phone,
          role,
          is_active,
          created_at
        `,
        [
          name.trim(),
          normalizedEmail,
          String(phone || '').trim() || null,
          hashedPassword,
          normalizedRole
        ]
      );

    const user =
      result.rows[0];

    // Create wallet automatically for every customer.
    await pool.query(
      `
      INSERT INTO wallets (
        user_id,
        balance
      )
      VALUES ($1, 0.00)
      ON CONFLICT (user_id)
      DO NOTHING
      `,
      [user.id]
    );

    const token =
      jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role
        },
        JWT_SECRET,
        {
          expiresIn: '7d'
        }
      );

    return res.status(201).json({
      success: true,
      message:
        'Registration successful.',
      token,
      user
    });

  } catch (error) {

    console.error(
      'Registration error:',
      error
    );

    return res.status(500).json({
      message:
        'Unable to complete registration right now.'
    });
  }
});

// Public ride tracking uses an unguessable, per-ride capability token.
// It returns only the minimum trip data needed by the public tracking page.
app.get('/api/public/rides/:trackingToken', async (req, res) => {
  const trackingToken = String(req.params.trackingToken || '').toLowerCase();
  if (!/^[a-f0-9]{48}$/i.test(trackingToken)) {
    return res.status(404).json({ success: false, message: 'Tracking link is invalid or expired.' });
  }

  try {
    const result = await pool.query(`
      SELECT r.id, r.status, r.pickup_address, r.pickup_latitude, r.pickup_longitude,
             r.destination_address, r.destination_latitude, r.destination_longitude,
             r.ride_type, r.passengers, r.fare, r.driver_eta_minutes,
             r.created_at, r.updated_at, u.name AS driver_name
      FROM rides r
      LEFT JOIN users u ON u.id = r.driver_id
      WHERE r.tracking_token = $1
      LIMIT 1
    `, [trackingToken]);

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Tracking link is invalid or expired.' });
    }

    const row = result.rows[0];
    const terminalStatuses = new Set(['COMPLETED', 'CANCELLED', 'CANCELED']);
    let location = null;
    if (!terminalStatuses.has(String(row.status || '').toUpperCase())) {
      const locationResult = await pool.query(`
        SELECT latitude, longitude, created_at
        FROM ride_locations
        WHERE ride_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [row.id]);
      if (locationResult.rows.length) {
        const latest = locationResult.rows[0];
        location = {
          latitude: Number(latest.latitude),
          longitude: Number(latest.longitude),
          createdAt: latest.created_at
        };
      }
    }

    const driverFirstName = row.driver_name ? String(row.driver_name).trim().split(/\s+/)[0] : null;
    return res.json({
      success: true,
      ride: {
        id: row.id,
        status: row.status,
        pickupAddress: row.pickup_address,
        pickupLatitude: row.pickup_latitude == null ? null : Number(row.pickup_latitude),
        pickupLongitude: row.pickup_longitude == null ? null : Number(row.pickup_longitude),
        destinationAddress: row.destination_address,
        destinationLatitude: row.destination_latitude == null ? null : Number(row.destination_latitude),
        destinationLongitude: row.destination_longitude == null ? null : Number(row.destination_longitude),
        rideType: row.ride_type,
        passengers: row.passengers,
        fare: Number(row.fare),
        driverEtaMinutes: row.driver_eta_minutes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      },
      driver: driverFirstName ? { firstName: driverFirstName } : null,
      location
    });
  } catch (error) {
    console.error('Public ride tracking error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load ride tracking right now.' });
  }
});

// ==========================================
// AUTHENTICATED API AREA
// ==========================================

app.use(
  '/api',
  authenticateToken
);

// ==========================================
// CURRENT USER
// ==========================================

app.get('/api/me', async (req, res) => {

  try {

    const result =
      await pool.query(
        `
        SELECT
          id,
          name,
          email,
          phone,
          role,
          is_active,
          created_at,
          updated_at
        FROM users
        WHERE id = $1
        LIMIT 1
        `,
        [req.user.id]
      );

    if (!result.rows.length) {
      return res.status(404).json({
        message:
          'User account not found.'
      });
    }

    return res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {

    console.error(
      'Current user error:',
      error
    );

    return res.status(500).json({
      message:
        'Unable to load your account.'
    });
  }
});
// ==========================================
// FAGA SERVICE / ROUTING CONFIGURATION
// ==========================================

const FAGA_ROUTING_URL =
  process.env.FAGA_ROUTING_URL ||
  'https://router.project-osrm.org';

const FAGA_GEOCODING_URL =
  process.env.FAGA_GEOCODING_URL ||
  'https://nominatim.openstreetmap.org/search';

const FAGA_SERVICE_COUNTRY =
  process.env.FAGA_SERVICE_COUNTRY ||
  'Nigeria';

const FAGA_SERVICE_STATE =
  process.env.FAGA_SERVICE_STATE ||
  'Lagos';

const FAGA_GEOCODING_COUNTRY_CODES =
  process.env.FAGA_GEOCODING_COUNTRY_CODES ||
  'ng';

const FAGA_GEOCODING_USER_AGENT =
  process.env.FAGA_GEOCODING_USER_AGENT ||
  'FAGA Logistics Platform';

// ==========================================
// ADDRESS HELPERS
// ==========================================

function normalizeAddressForFaga(
  address
) {
  return String(
    address || ''
  )
    .trim()
    .replace(/\s+/g, ' ');
}

function isNigeriaAddress(
  address
) {
  return /nigeria/i.test(
    String(address || '')
  );
}

function isLagosAddress(
  address
) {
  return /lagos/i.test(
    String(address || '')
  );
}

// ==========================================
// FAGA LAGOS ADDRESS BUILDER
// ==========================================
//
// FAGA currently operates in Lagos State.
//
// Examples:
//
// Yaba
//      -> Yaba, Lagos, Nigeria
//
// Awoyaya
//      -> Awoyaya, Lagos, Nigeria
//
// Ikeja
//      -> Ikeja, Lagos, Nigeria
//
// Ajah, Lagos
//      -> Ajah, Lagos, Nigeria
//
// Lekki, Nigeria
//      -> Lekki, Nigeria
//
// Full addresses containing Lagos/Nigeria
// are preserved.
//

function buildFagaGeocodingQuery(
  address
) {

  const cleanAddress =
    normalizeAddressForFaga(
      address
    );

  if (!cleanAddress) {
    return '';
  }

  if (
    isNigeriaAddress(
      cleanAddress
    )
  ) {
    return cleanAddress;
  }

  if (
    isLagosAddress(
      cleanAddress
    )
  ) {
    return `${cleanAddress}, Nigeria`;
  }

  return `${cleanAddress}, Lagos, Nigeria`;
}

// ==========================================
// LAGOS LOCATION VALIDATOR
// ==========================================

function resultBelongsToLagos(
  result
) {

  if (!result) {
    return false;
  }

  const address =
    result.address || {};

  const combined = [
    result.display_name,
    address.state,
    address.state_district,
    address.county,
    address.city,
    address.town,
    address.municipality,
    address.village,
    address.suburb
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    combined.includes('lagos') ||
    combined.includes('lagos state')
  );
}

// ==========================================
// FAGA GEOCODING SCORE
// ==========================================
//
// Nominatim can return several possible matches.
// Lagos results must receive priority because
// FAGA currently operates in Lagos State.
//

function scoreFagaGeocodingResult(
  result,
  requestedAddress
) {

  const address =
    result?.address || {};

  const displayName =
    String(
      result?.display_name || ''
    ).toLowerCase();

  const requested =
    String(
      requestedAddress || ''
    ).toLowerCase();

  let score = 0;

  // Strong preference for Lagos.
  if (
    resultBelongsToLagos(
      result
    )
  ) {
    score += 100;
  }

  // Strong preference for Nigeria.
  if (
    displayName.includes(
      'nigeria'
    )
  ) {
    score += 30;
  }

  // Exact-ish textual match.
  if (
    requested &&
    displayName.includes(
      requested
    )
  ) {
    score += 20;
  }

  // Prefer city/town/locality results.
  if (
    address.city ||
    address.town ||
    address.municipality
  ) {
    score += 10;
  }

  // Prefer results with a real road.
  if (
    address.road
  ) {
    score += 5;
  }

  return score;
}

// ==========================================
// FAGA ADDRESS GEOCODING
// ==========================================

async function geocodeFagaAddress(
  address
) {

  const cleanAddress =
    normalizeAddressForFaga(
      address
    );

  if (!cleanAddress) {
    throw new Error(
      'Address is required for geocoding.'
    );
  }

  /*
   * FAGA CURRENT SERVICE AREA
   *
   * FAGA currently operates in
   * Lagos State.
   */

  const serviceCountry =
    FAGA_SERVICE_COUNTRY;

  const serviceState =
    FAGA_SERVICE_STATE;

  /*
   * Convert simple Nigerian addresses
   * into Lagos-specific search queries.
   */

  const geocodingQuery =
    buildFagaGeocodingQuery(
      cleanAddress
    );

  console.log(
    'FAGA geocoding query:',
    geocodingQuery
  );

  try {

    const response =
      await axios.get(
        FAGA_GEOCODING_URL,
        {
          params: {
            q:
              geocodingQuery,

            format:
              'json',

            limit:
              10,

            addressdetails:
              1,

            countrycodes:
              FAGA_GEOCODING_COUNTRY_CODES
          },

          headers: {
            'User-Agent':
              FAGA_GEOCODING_USER_AGENT,

            Accept:
              'application/json'
          },

          timeout:
            10000
        }
      );

    const results =
      Array.isArray(
        response.data
      )
        ? response.data
        : [];

    if (
      !results.length
    ) {
      throw new Error(
        `Unable to locate "${cleanAddress}". Please enter a more specific Lagos address.`
      );
    }

    /*
     * Score all returned results.
     */

    const scoredResults =
      results
        .map(
          result => ({
            result,

            score:
              scoreFagaGeocodingResult(
                result,
                cleanAddress
              )
          })
        )
        .sort(
          (a, b) =>
            b.score - a.score
        );

    /*
     * Select the highest-quality result
     * that belongs to Lagos.
     */

    const selected =
      scoredResults.find(
        item =>
          resultBelongsToLagos(
            item.result
          )
      ) ||
      scoredResults[0];

    if (
      !selected ||
      !selected.result
    ) {
      throw new Error(
        `Unable to locate "${cleanAddress}".`
      );
    }

    const result =
      selected.result;

    /*
     * Final Lagos validation.
     */

    if (
      !resultBelongsToLagos(
        result
      )
    ) {

      throw new Error(
        `FAGA currently operates in ${serviceState} State, ${serviceCountry}. Please enter a Lagos address.`
      );
    }

    const latitude =
      Number(
        result.lat
      );

    const longitude =
      Number(
        result.lon
      );

    if (
      !Number.isFinite(
        latitude
      ) ||
      !Number.isFinite(
        longitude
      )
    ) {
      throw new Error(
        'The geocoding service returned invalid coordinates.'
      );
    }

    const displayName =
      result.display_name ||
      cleanAddress;

    console.log(
      'FAGA geocoding selected:',
      displayName
    );

    console.log(
      'FAGA coordinates:',
      latitude,
      longitude
    );

    return {
      latitude,
      longitude,
      displayName
    };

  } catch (error) {

    /*
     * Preserve our intentional service-area
     * errors instead of replacing them with
     * a generic Axios error.
     */

    if (
      error.message &&
      (
        error.message.includes(
          'FAGA currently operates'
        ) ||
        error.message.includes(
          'Unable to locate'
        )
      )
    ) {
      throw error;
    }

    console.error(
      'FAGA geocoding error:',
      error.response?.data ||
      error.message ||
      error
    );

    throw new Error(
      `Unable to locate "${cleanAddress}" right now. Please check the address and try again.`
    );
  }
}

// ==========================================
// FAGA PUBLIC GEOCODING API
// ==========================================
//
// IMPORTANT:
//
// This MUST be outside
// geocodeFagaAddress().
//
// Previously this route was accidentally
// nested inside the function, which caused:
//
// GET /api/geocode -> 404
//
// The route is intentionally registered
// here at application level.
//

app.get(
  '/api/geocode',
  async (req, res) => {

    const address =
      normalizeAddressForFaga(
        req.query.address
      );

    if (!address) {
      return res.status(422).json({
        success: false,
        message:
          'Address is required.'
      });
    }

    try {

      console.log(
        'FAGA /api/geocode request:',
        address
      );

      const location =
        await geocodeFagaAddress(
          address
        );

      console.log(
        'FAGA /api/geocode result:',
        location
      );

      return res.json({
        success: true,

        location: {
          latitude:
            Number(
              location.latitude
            ),

          longitude:
            Number(
              location.longitude
            ),

          displayName:
            location.displayName ||
            address
        }
      });

    } catch (error) {

      console.error(
        'FAGA /api/geocode error:',
        error
      );

      return res.status(422).json({
        success: false,

        message:
          error.message ||
          'Unable to locate this address.'
      });
    }
  }
);

// ==========================================
// FAGA COORDINATE RESOLUTION
// ==========================================
//
// If valid coordinates are supplied by
// the frontend, use them.
//
// Otherwise geocode the address on the
// backend.
//

async function resolveFagaCoordinates({
  address,
  latitude,
  longitude
}) {


  const hasLatitude =
    latitude !== null &&
    latitude !== undefined &&
    String(latitude).trim() !== '';

  const hasLongitude =
    longitude !== null &&
    longitude !== undefined &&
    String(longitude).trim() !== '';

  const numericLatitude = Number(latitude);
  const numericLongitude = Number(longitude);

  const validCoordinates =
    hasLatitude &&
    hasLongitude &&
    Number.isFinite(numericLatitude) &&
    Number.isFinite(numericLongitude) &&
    numericLatitude >= -90 &&
    numericLatitude <= 90 &&
    numericLongitude >= -180 &&
    numericLongitude <= 180;

  if (validCoordinates) {
    return {
      latitude: numericLatitude,
      longitude: numericLongitude,
      displayName: address
    };
  }

  return geocodeFagaAddress(address);

}

// ==========================================
// FAGA ROAD ROUTING
// ==========================================
//
// Uses the real road network.
//
// Input:
// latitude/longitude
//
// Output:
// distanceKm
// durationMinutes
// geometry
//

async function getFagaRoadRoute(
  pickupLatitude,
  pickupLongitude,
  destinationLatitude,
  destinationLongitude
) {

  const startLatitude =
    Number(
      pickupLatitude
    );

  const startLongitude =
    Number(
      pickupLongitude
    );

  const endLatitude =
    Number(
      destinationLatitude
    );

  const endLongitude =
    Number(
      destinationLongitude
    );

  if (
    !Number.isFinite(
      startLatitude
    ) ||
    !Number.isFinite(
      startLongitude
    ) ||
    !Number.isFinite(
      endLatitude
    ) ||
    !Number.isFinite(
      endLongitude
    )
  ) {

    throw new Error(
      'Invalid coordinates supplied for route calculation.'
    );
  }

  const coordinates =
    `${startLongitude},${startLatitude};` +
    `${endLongitude},${endLatitude}`;

  const url =
    `${FAGA_ROUTING_URL}/route/v1/driving/${coordinates}`;

  try {

    const response =
      await axios.get(
        url,
        {
          params: {
            overview:
              'full',

            geometries:
              'geojson',

            alternatives:
              false,

            steps:
              false
          },

          timeout:
            15000,

          headers: {
            Accept:
              'application/json',

            'User-Agent':
              'FAGA-Ride-Engine/1.0'
          }
        }
      );

    const data =
      response.data;

    if (
      !data ||
      data.code !== 'Ok' ||
      !Array.isArray(
        data.routes
      ) ||
      !data.routes.length
    ) {

      throw new Error(
        data?.message ||
        'No driving route was found.'
      );
    }

    const route =
      data.routes[0];

    const rawDistance =
      Number(
        route.distance
      );

    const rawDuration =
      Number(
        route.duration
      );

    if (
      !Number.isFinite(
        rawDistance
      ) ||
      !Number.isFinite(
        rawDuration
      )
    ) {

      throw new Error(
        'Invalid route information returned.'
      );
    }

    const distanceKm =
      Number(
        (
          rawDistance / 1000
        ).toFixed(2)
      );

    const durationMinutes =
      Math.max(
        1,
        Math.ceil(
          rawDuration / 60
        )
      );

    return {
      distanceKm,

      durationMinutes,

      geometry:
        route.geometry?.coordinates ||
        []
    };

  } catch (error) {

    console.error(
      'FAGA routing error:',
      error.response?.data ||
      error.message ||
      error
    );

    throw new Error(
      'Unable to calculate the road route right now. Please try again.'
    );
  }
}

// ==========================================
// FAGA RIDE ROUTE BUILDER
// ==========================================

async function buildFagaRoute({
  pickupAddress,
  destinationAddress,

  pickupLatitude,
  pickupLongitude,

  destinationLatitude,
  destinationLongitude
}) {

  const pickup =
    await resolveFagaCoordinates({
      address:
        pickupAddress,

      latitude:
        pickupLatitude,

      longitude:
        pickupLongitude
    });

  const destination =
    await resolveFagaCoordinates({
      address:
        destinationAddress,

      latitude:
        destinationLatitude,

      longitude:
        destinationLongitude
    });

  const route =
    await getFagaRoadRoute(
      pickup.latitude,
      pickup.longitude,

      destination.latitude,
      destination.longitude
    );

  const estimatedArrivalAt =
    new Date(
      Date.now() +
      route.durationMinutes *
      60 *
      1000
    );

  return {
    pickup,

    destination,

    distanceKm:
      route.distanceKm,

    durationMinutes:
      route.durationMinutes,

    estimatedArrivalAt,

    routeGeometry:
      route.geometry
  };
}
// ==========================================
// REAL RIDE ESTIMATE
// ==========================================
//
// POST /api/rides/estimate
//
// Calculates:
// - real road distance
// - real route duration
// - estimated arrival time
// - estimated fare
//
// No ride is created here.
// ==========================================

app.post(
  '/api/rides/estimate',
  async (req, res) => {

    const {
      pickupAddress,
      destinationAddress,

      pickupLatitude = null,
      pickupLongitude = null,

      destinationLatitude = null,
      destinationLongitude = null,

      rideType = 'economy',
      passengers = 1
    } = req.body;

    // ------------------------------------------
    // REQUIRED ADDRESSES
    // ------------------------------------------

    if (
      !pickupAddress ||
      !destinationAddress
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Pickup and destination are required.'
      });
    }

    // ------------------------------------------
    // FAGA RIDE TYPES
    // ------------------------------------------

    const allowedRideTypes = {
      economy: 1800,
      comfort: 2500,
      xl: 3500
    };

    const normalizedRideType =
      String(
        rideType
      )
        .trim()
        .toLowerCase();

    const passengerCount =
      Number(
        passengers
      );

    // ------------------------------------------
    // VALIDATE RIDE TYPE
    // ------------------------------------------

    if (
      !Object.prototype.hasOwnProperty.call(
        allowedRideTypes,
        normalizedRideType
      )
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Invalid ride type.'
      });
    }

    // ------------------------------------------
    // VALIDATE PASSENGERS
    // ------------------------------------------

    if (
      !Number.isInteger(
        passengerCount
      ) ||
      passengerCount < 1 ||
      passengerCount > 6
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Passengers must be between 1 and 6.'
      });
    }

    try {

      // ----------------------------------------
      // BUILD REAL ROAD ROUTE
      // ----------------------------------------

      const route =
        await buildFagaRoute({
          pickupAddress,
          destinationAddress,

          pickupLatitude,
          pickupLongitude,

          destinationLatitude,
          destinationLongitude
        });

      // ----------------------------------------
      // FARE CALCULATION
      // ----------------------------------------
      //
      // Base fare:
      //
      // economy = ₦1,800
      // comfort = ₦2,500
      // xl      = ₦3,500
      //
      // Additional passengers:
      // ₦150 each.
      //
      // Actual ride fare is calculated again
      // during booking on the backend.
      //

            const baseFare =
        allowedRideTypes[normalizedRideType];

      const passengerSurcharge =
        Math.max(0, passengerCount - 1) * 150;

      const distanceCharge =
        Number(route.distanceKm) * 250;

      const rawFare =
        baseFare +
        distanceCharge +
        passengerSurcharge;

      const fare =
        Math.max(0, Math.round(rawFare / 50) * 50);

      // ----------------------------------------
      // RETURN ESTIMATE
      // ----------------------------------------

      return res.json({
        success: true,

        estimate: {

          pickup:
            route.pickup,

          destination:
            route.destination,

          distanceKm:
            route.distanceKm,

          durationMinutes:
            route.durationMinutes,

          estimatedArrivalAt:
            route.estimatedArrivalAt,

          fare,

          rideType:
            normalizedRideType,

          passengers:
            passengerCount,

          routeGeometry:
            route.routeGeometry
        }
      });

    } catch (error) {

      console.error(
        'FAGA ride estimate error:',
        error
      );

      return res.status(422).json({
        success: false,

        message:
          error.message ||
          'Unable to calculate ride estimate.'
      });
    }
  }
);

// ==========================================
// RIDE ROUTE CALCULATOR
// ==========================================
//
// IMPORTANT:
// There is intentionally only ONE
// calculateRideRoute() function in this
// version of index.js.
//
// The previous backend had two functions
// with the same name:
//
// 1. positional arguments
// 2. object arguments
//
// That created confusing function
// resolution and maintenance problems.
//
// This version uses the object format
// everywhere.
//

async function calculateRideRoute({
  pickupLatitude,
  pickupLongitude,
  destinationLatitude,
  destinationLongitude
}) {

  // ------------------------------------------
  // VALIDATE COORDINATES
  // ------------------------------------------

  if (
    pickupLatitude === null ||
    pickupLatitude === undefined ||
    pickupLongitude === null ||
    pickupLongitude === undefined ||
    destinationLatitude === null ||
    destinationLatitude === undefined ||
    destinationLongitude === null ||
    destinationLongitude === undefined
  ) {

    return null;
  }

  const startLatitude =
    Number(
      pickupLatitude
    );

  const startLongitude =
    Number(
      pickupLongitude
    );

  const endLatitude =
    Number(
      destinationLatitude
    );

  const endLongitude =
    Number(
      destinationLongitude
    );

  if (
    !Number.isFinite(
      startLatitude
    ) ||
    !Number.isFinite(
      startLongitude
    ) ||
    !Number.isFinite(
      endLatitude
    ) ||
    !Number.isFinite(
      endLongitude
    )
  ) {

    return null;
  }

  // ------------------------------------------
  // OSRM ROUTE
  // ------------------------------------------

  const coordinates =
    `${startLongitude},${startLatitude};` +
    `${endLongitude},${endLatitude}`;

  const url =
    `${FAGA_ROUTING_URL}/route/v1/driving/${coordinates}`;

  try {

    const response =
      await axios.get(
        url,
        {
          params: {
            overview:
              'false',

            alternatives:
              false,

            steps:
              false
          },

          timeout:
            15000,

          headers: {
            Accept:
              'application/json',

            'User-Agent':
              'FAGA-Ride-Engine/1.0'
          }
        }
      );

    if (
      !response.data ||
      response.data.code !== 'Ok' ||
      !Array.isArray(
        response.data.routes
      ) ||
      !response.data.routes.length
    ) {

      return null;
    }

    const route =
      response.data.routes[0];

    const distanceKm =
      Number(
        route.distance
      ) / 1000;

    const durationMinutes =
      Math.max(
        1,
        Math.ceil(
          Number(
            route.duration
          ) / 60
        )
      );

    if (
      !Number.isFinite(
        distanceKm
      ) ||
      !Number.isFinite(
        durationMinutes
      )
    ) {

      return null;
    }

    return {

      distanceKm:
        Number(
          distanceKm.toFixed(2)
        ),

      durationMinutes,

      driverEtaMinutes:
        null
    };

  } catch (error) {

    console.error(
      'FAGA calculateRideRoute error:',
      error.response?.data ||
      error.message ||
      error
    );

    return null;
  }
}

// ==========================================
// LIVE RIDE BOOKING
// ==========================================
//
// POST /api/rides
//
// Creates an actual ride request.
//
// Initial status:
//
// SEARCHING
//
// This means the customer has requested
// a ride and the platform can begin looking
// for an available driver.
//

app.post(
  '/api/rides',
  async (req, res) => {

    const {
      pickupAddress,
      destinationAddress,

      rideType = 'economy',
      passengers = 1,

      pickupLatitude = null,
      pickupLongitude = null,

      destinationLatitude = null,
      destinationLongitude = null
    } = req.body;

    // ------------------------------------------
    // RIDE TYPES
    // ------------------------------------------

    const allowedRideTypes = {
      economy: 1800,
      comfort: 2500,
      xl: 3500
    };

    const normalizedRideType =
      String(
        rideType
      )
        .trim()
        .toLowerCase();

    const passengerCount =
      Number(
        passengers
      );

    // ------------------------------------------
    // VALIDATE ADDRESSES
    // ------------------------------------------

    if (
      !pickupAddress ||
      !destinationAddress
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Pickup and destination are required.'
      });
    }

    // ------------------------------------------
    // VALIDATE RIDE TYPE
    // ------------------------------------------

    if (
      !Object.prototype.hasOwnProperty.call(
        allowedRideTypes,
        normalizedRideType
      )
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Invalid ride type.'
      });
    }

    // ------------------------------------------
    // VALIDATE PASSENGERS
    // ------------------------------------------

    if (
      !Number.isInteger(
        passengerCount
      ) ||
      passengerCount < 1 ||
      passengerCount > 6
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Passengers must be between 1 and 6.'
      });
    }

    try {

      // ----------------------------------------
      // RESOLVE PICKUP
      // ----------------------------------------

      const pickup =
        await resolveFagaCoordinates({
          address:
            pickupAddress,

          latitude:
            pickupLatitude,

          longitude:
            pickupLongitude
        });

      // ----------------------------------------
      // RESOLVE DESTINATION
      // ----------------------------------------

      const destination =
        await resolveFagaCoordinates({
          address:
            destinationAddress,

          latitude:
            destinationLatitude,

          longitude:
            destinationLongitude
        });

      // ----------------------------------------
      // REAL ROAD ROUTE
      // ----------------------------------------

      const route =
        await calculateRideRoute({
          pickupLatitude:
            pickup.latitude,

          pickupLongitude:
            pickup.longitude,

          destinationLatitude:
            destination.latitude,

          destinationLongitude:
            destination.longitude
        });

      /*
       * The ride cannot safely be created
       * without a valid road route.
       */

      if (!route) {

        return res.status(422).json({
          success: false,

          message:
            'Unable to calculate the road route for this ride. Please check the pickup and destination addresses and try again.'
        });
      }

      // ----------------------------------------
      // FARE
      // ----------------------------------------

      const baseFare =
        allowedRideTypes[
          normalizedRideType
        ];

      const passengerSurcharge =
        Math.max(
          0,
          passengerCount - 1
        ) * 150;

      /*
       * Distance charge:
       *
       * ₦250 per kilometre.
       */

      const distanceCharge =
        Number(
          route.distanceKm
        ) * 250;

      /*
       * Calculate total.
       */

      const rawFare =
        baseFare +
        distanceCharge +
        passengerSurcharge;

      /*
       * Round to nearest ₦50.
       */

      const fare =
        Math.max(
          0,
          Math.round(
            rawFare / 50
          ) * 50
        );

      // ----------------------------------------
      // ETA
      // ----------------------------------------

      const estimatedArrivalAt =
        new Date(
          Date.now() +
          route.durationMinutes *
          60 *
          1000
        );

      // ----------------------------------------
      // CREATE RIDE
      // ----------------------------------------

      const trackingToken = crypto.randomBytes(24).toString('hex');

      const rideResult =
        await pool.query(
          `
          INSERT INTO rides (
            customer_id,

            pickup_address,
            pickup_latitude,
            pickup_longitude,

            destination_address,
            destination_latitude,
            destination_longitude,

            ride_type,
            passengers,

            fare,
            status,

            distance_km,
            duration_minutes,
            driver_eta_minutes,
            estimated_arrival_at,
            route_geometry,
            tracking_token,

            created_at,
            updated_at
          )
          VALUES (
            $1,

            $2,
            $3,
            $4,

            $5,
            $6,
            $7,

            $8,
            $9,

            $10,
            'SEARCHING',

            $11,
            $12,
            $13,
            $14,
            $15,
            $16,

            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
          RETURNING *
          `,
          [
            req.user.id,

            pickupAddress,
            pickup.latitude,
            pickup.longitude,

            destinationAddress,
            destination.latitude,
            destination.longitude,

            normalizedRideType,
            passengerCount,

            fare,

            route.distanceKm,
            route.durationMinutes,
            route.driverEtaMinutes,
            estimatedArrivalAt,

            JSON.stringify(
              route
                ? route
                : {}
            ),
            trackingToken
          ]
        );

      const ride =
        rideResult.rows[0];

      // ----------------------------------------
      // RESPONSE
      // ----------------------------------------

      return res.status(201).json({
        success: true,

        message:
          'Ride request created successfully.',

        ride: {

          id:
            ride.id,

          customerId:
            ride.customer_id,

          pickupAddress:
            ride.pickup_address,

          pickupLatitude:
            Number(
              ride.pickup_latitude
            ),

          pickupLongitude:
            Number(
              ride.pickup_longitude
            ),

          destinationAddress:
            ride.destination_address,

          destinationLatitude:
            Number(
              ride.destination_latitude
            ),

          destinationLongitude:
            Number(
              ride.destination_longitude
            ),

          rideType:
            ride.ride_type,

          passengers:
            ride.passengers,

          fare:
            Number(
              ride.fare
            ),

          status:
            ride.status,

          distanceKm:
            Number(
              ride.distance_km
            ),

          durationMinutes:
            ride.duration_minutes,

          driverEtaMinutes:
            ride.driver_eta_minutes,

          estimatedArrivalAt:
            ride.estimated_arrival_at,

          routeGeometry:
            ride.route_geometry,

          trackingToken:
            ride.tracking_token,

          createdAt:
            ride.created_at,

          updatedAt:
            ride.updated_at
        }
      });

    } catch (error) {

      console.error(
        'FAGA ride creation error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          error.message ||
          'Unable to create the ride request right now.'
      });
    }
  }
);

// ==========================================
// GET CUSTOMER RIDES
// ==========================================
//
// Returns the authenticated customer's
// recent rides.
//

app.get(
  '/api/rides',
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            id,

            customer_id,
            driver_id,

            pickup_address,
            pickup_latitude,
            pickup_longitude,

            destination_address,
            destination_latitude,
            destination_longitude,

            ride_type,
            passengers,

            fare,
            status,

            distance_km,
            duration_minutes,
            driver_eta_minutes,
            estimated_arrival_at,
            route_geometry,
            tracking_token,

            created_at,
            updated_at

          FROM rides

          WHERE customer_id = $1

          ORDER BY
            created_at DESC

          LIMIT 50
          `,
          [req.user.id]
        );

      return res.json({
        success: true,

        rides:
          result.rows
      });

    } catch (error) {

      console.error(
        'FAGA customer rides error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Unable to load rides right now.'
      });
    }
  }
);

// ==========================================
// GET SINGLE RIDE
// ==========================================
//
// Customer can only access their own ride.
// Drivers can access rides assigned to them.
//

app.get(
  '/api/rides/:rideId',
  async (req, res) => {

    const rideId =
      Number(
        req.params.rideId
      );

    if (
      !Number.isInteger(
        rideId
      ) ||
      rideId <= 0
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Invalid ride ID.'
      });
    }

    try {

      const result =
        await pool.query(
          `
          SELECT
            r.*,

            driver.name AS driver_name,
            driver.email AS driver_email

          FROM rides r

          LEFT JOIN users driver
            ON driver.id = r.driver_id

          WHERE
            r.id = $1
            AND (
              r.customer_id = $2
              OR r.driver_id = $2
              OR $3 IN (
                'admin',
                'super_admin'
              )
            )

          LIMIT 1
          `,
          [
            rideId,
            req.user.id,
            req.user.role
          ]
        );

      if (
        !result.rows.length
      ) {

        return res.status(404).json({
          success: false,

          message:
            'Ride not found.'
        });
      }

      return res.json({
        success: true,

        ride:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        'FAGA single ride error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Unable to load this ride.'
      });
    }
  }
);
// ==========================================
// UPDATE RIDE STATUS
// ==========================================
//
// Used by the driver/admin operational flow.
//
// Supported lifecycle:
//
// SEARCHING
// DRIVER_ASSIGNED
// DRIVER_ARRIVING
// DRIVER_ARRIVED
// IN_PROGRESS
// COMPLETED
// CANCELLED
//
// ==========================================

const allowedRideStatuses = [
  'SEARCHING',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
];

app.patch(
  '/api/rides/:rideId/status',
  async (req, res) => {

    const rideId =
      Number(
        req.params.rideId
      );

    const requestedStatus =
      String(
        req.body.status || ''
      )
        .trim()
        .toUpperCase();

    if (
      !Number.isInteger(
        rideId
      ) ||
      rideId <= 0
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Invalid ride ID.'
      });
    }

    if (
      !allowedRideStatuses.includes(
        requestedStatus
      )
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Invalid ride status.'
      });
    }

    try {

      const rideResult =
        await pool.query(
          `
          SELECT
            id,
            customer_id,
            driver_id,
            status
          FROM rides
          WHERE id = $1
          LIMIT 1
          `,
          [rideId]
        );

      if (
        !rideResult.rows.length
      ) {

        return res.status(404).json({
          success: false,

          message:
            'Ride not found.'
        });
      }

      const ride =
        rideResult.rows[0];

      /*
       * Customers are only allowed to cancel
       * their own active ride.
       */

      if (
        req.user.role === 'customer' &&
        ride.customer_id === req.user.id
      ) {

        if (
          requestedStatus !== 'CANCELLED'
        ) {

          return res.status(403).json({
            success: false,

            message:
              'Customers can only cancel their ride from this endpoint.'
          });
        }

      } else if (
        req.user.role !== 'admin' &&
        req.user.role !== 'super_admin' &&
        ride.driver_id !== req.user.id
      ) {

        return res.status(403).json({
          success: false,

          message:
            'You are not authorized to update this ride.'
        });
      }

      /*
       * Prevent changing a completed ride
       * or cancelled ride back into an active
       * state.
       */

      if (
        ride.status === 'COMPLETED' ||
        ride.status === 'CANCELLED'
      ) {

        return res.status(409).json({
          success: false,

          message:
            `This ride is already ${ride.status.toLowerCase()}.`
        });
      }

      const updated =
        await pool.query(
          `
          UPDATE rides

          SET
            status = $1,
            updated_at = CURRENT_TIMESTAMP,

            cancelled_at =
              CASE
                WHEN $1 = 'CANCELLED'
                THEN CURRENT_TIMESTAMP
                ELSE cancelled_at
              END,

            completed_at =
              CASE
                WHEN $1::varchar = 'COMPLETED'::varchar
                THEN CURRENT_TIMESTAMP
                ELSE completed_at
              END

          WHERE id = $2

          RETURNING *
          `,
          [
            requestedStatus,
            rideId
          ]
        );

      return res.json({
        success: true,

        message:
          `Ride status updated to ${requestedStatus}.`,

        ride:
          updated.rows[0]
      });

    } catch (error) {

      console.error(
        'FAGA ride status update error:',
        error
      );

      /*
       * If completed_at/cancelled_at columns
       * do not exist in an older database,
       * return a clear database message.
       */

      return res.status(500).json({
        success: false,

        message:
          error.message ||
          'Unable to update ride status.'
      });
    }
  }
);

// ==========================================
// ASSIGN DRIVER TO RIDE
// ==========================================
//
// Admin/operations can assign a driver.
//
// This changes:
//
// SEARCHING
//      ↓
// DRIVER_ASSIGNED
//
// ==========================================

app.patch(
  '/api/rides/:rideId/assign',
  async (req, res) => {

    const rideId =
      Number(
        req.params.rideId
      );

    const driverId =
      Number(
        req.body.driverId
      );

    if (
      !Number.isInteger(
        rideId
      ) ||
      rideId <= 0
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Invalid ride ID.'
      });
    }

    if (
      !Number.isInteger(
        driverId
      ) ||
      driverId <= 0
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Valid driver ID is required.'
      });
    }

    /*
     * Only operations/admin accounts should
     * assign drivers.
     */

    if (
      req.user.role !== 'admin' &&
      req.user.role !== 'super_admin'
    ) {

      return res.status(403).json({
        success: false,

        message:
          'Only authorized operations staff can assign drivers.'
      });
    }

    try {

      const driverResult =
        await pool.query(
          `
          SELECT
            id,
            name,
            email,
            role,
            is_active
          FROM users
          WHERE id = $1
          LIMIT 1
          `,
          [driverId]
        );

      if (
        !driverResult.rows.length
      ) {

        return res.status(404).json({
          success: false,

          message:
            'Driver account not found.'
        });
      }

      const driver =
        driverResult.rows[0];

      if (
        !driver.is_active
      ) {

        return res.status(409).json({
          success: false,

          message:
            'This driver account is inactive.'
        });
      }

      /*
       * The account must be a rider/driver.
       */

      if (
        driver.role !== 'rider' &&
        driver.role !== 'driver'
      ) {

        return res.status(422).json({
          success: false,

          message:
            'Selected user is not a driver.'
        });
      }

      const result =
        await pool.query(
          `
          UPDATE rides

          SET
            driver_id = $1,
            status = 'DRIVER_ASSIGNED',
            updated_at = CURRENT_TIMESTAMP

          WHERE id = $2

          RETURNING *
          `,
          [
            driverId,
            rideId
          ]
        );

      if (
        !result.rows.length
      ) {

        return res.status(404).json({
          success: false,

          message:
            'Ride not found.'
        });
      }

      return res.json({
        success: true,

        message:
          'Driver assigned successfully.',

        ride:
          result.rows[0],

        driver: {
          id:
            driver.id,

          name:
            driver.name,

          email:
            driver.email
        }
      });

    } catch (error) {

      console.error(
        'FAGA driver assignment error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Unable to assign driver right now.'
      });
    }
  }
);

// ==========================================
// GET DRIVER'S ACTIVE RIDES
// ==========================================

app.get(
  '/api/driver/rides',
  async (req, res) => {

    if (
      req.user.role !== 'rider' &&
      req.user.role !== 'driver' &&
      req.user.role !== 'admin' &&
      req.user.role !== 'super_admin'
    ) {

      return res.status(403).json({
        success: false,

        message:
          'Driver access required.'
      });
    }

    try {

      const result =
        await pool.query(
          `
          SELECT
            r.*,

            customer.name AS customer_name,
            customer.email AS customer_email

          FROM rides r

          INNER JOIN users customer
            ON customer.id = r.customer_id

          WHERE
            r.driver_id = $1

          ORDER BY
            r.created_at DESC

          LIMIT 50
          `,
          [req.user.id]
        );

      return res.json({
        success: true,

        rides:
          result.rows
      });

    } catch (error) {

      console.error(
        'FAGA driver rides error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Unable to load driver rides.'
      });
    }
  }
);

// ==========================================
// UPDATE DRIVER LOCATION
// ==========================================
//
// The driver sends GPS coordinates while
// an active ride is running.
//
// This information is stored in:
//
// ride_locations
//
// It can then be consumed by:
//
// ride-tracking.html
//
// ==========================================

app.post(
  '/api/rides/:rideId/location',
  async (req, res) => {

    const rideId =
      Number(
        req.params.rideId
      );

    const latitude =
      Number(
        req.body.latitude
      );

    const longitude =
      Number(
        req.body.longitude
      );

    if (
      !Number.isInteger(
        rideId
      ) ||
      rideId <= 0
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Invalid ride ID.'
      });
    }

    if (
      !Number.isFinite(
        latitude
      ) ||
      !Number.isFinite(
        longitude
      )
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Valid latitude and longitude are required.'
      });
    }

    /*
     * Basic geographic validation.
     */

    if (
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Invalid GPS coordinates.'
      });
    }

    try {

      const rideResult =
        await pool.query(
          `
          SELECT
            id,
            customer_id,
            driver_id,
            status
          FROM rides
          WHERE id = $1
          LIMIT 1
          `,
          [rideId]
        );

      if (
        !rideResult.rows.length
      ) {

        return res.status(404).json({
          success: false,

          message:
            'Ride not found.'
        });
      }

      const ride =
        rideResult.rows[0];

      /*
       * Only the assigned driver or an
       * authorized administrator can send
       * ride GPS data.
       */

      const authorized =
        ride.driver_id === req.user.id ||
        req.user.role === 'admin' ||
        req.user.role === 'super_admin';

      if (!authorized) {

        return res.status(403).json({
          success: false,

          message:
            'You are not authorized to update this ride location.'
        });
      }

      /*
       * Don't continue tracking completed
       * or cancelled rides.
       */

      if (
        ride.status === 'COMPLETED' ||
        ride.status === 'CANCELLED'
      ) {

        return res.status(409).json({
          success: false,

          message:
            `Ride is already ${ride.status.toLowerCase()}.`
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO ride_locations (
            ride_id,
            latitude,
            longitude,
            created_at
          )
          VALUES (
            $1,
            $2,
            $3,
            CURRENT_TIMESTAMP
          )
          RETURNING *
          `,
          [
            rideId,
            latitude,
            longitude
          ]
        );

      return res.status(201).json({
        success: true,

        location:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        'FAGA ride location update error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Unable to update ride location.'
      });
    }
  }
);

// ==========================================
// GET LATEST RIDE LOCATION
// ==========================================
//
// Used by the customer tracking page.
//

app.get(
  '/api/rides/:rideId/location',
  async (req, res) => {

    const rideId =
      Number(
        req.params.rideId
      );

    if (
      !Number.isInteger(
        rideId
      ) ||
      rideId <= 0
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Invalid ride ID.'
      });
    }

    try {

      /*
       * First verify that the authenticated
       * user is allowed to see this ride.
       */

      const rideResult =
        await pool.query(
          `
          SELECT
            id,
            customer_id,
            driver_id,
            status
          FROM rides
          WHERE id = $1
          LIMIT 1
          `,
          [rideId]
        );

      if (
        !rideResult.rows.length
      ) {

        return res.status(404).json({
          success: false,

          message:
            'Ride not found.'
        });
      }

      const ride =
        rideResult.rows[0];

      const authorized =
        ride.customer_id === req.user.id ||
        ride.driver_id === req.user.id ||
        req.user.role === 'admin' ||
        req.user.role === 'super_admin';

      if (!authorized) {

        return res.status(403).json({
          success: false,

          message:
            'You are not authorized to view this ride.'
        });
      }

      /*
       * Get the most recent GPS point.
       */

      const result =
        await pool.query(
          `
          SELECT
            id,
            ride_id,
            latitude,
            longitude,
            created_at

          FROM ride_locations

          WHERE ride_id = $1

          ORDER BY
            created_at DESC

          LIMIT 1
          `,
          [rideId]
        );

      if (
        !result.rows.length
      ) {

        return res.json({
          success: true,

          location:
            null
        });
      }

      return res.json({
        success: true,

        location:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        'FAGA latest ride location error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Unable to load ride location.'
      });
    }
  }
);

// ==========================================
// GET RIDE LOCATION HISTORY
// ==========================================
//
// Used by tracking/operations pages when
// a complete GPS trail is required.
//

app.get(
  '/api/rides/:rideId/locations',
  async (req, res) => {

    const rideId =
      Number(
        req.params.rideId
      );

    if (
      !Number.isInteger(
        rideId
      ) ||
      rideId <= 0
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Invalid ride ID.'
      });
    }

    try {

      const rideResult =
        await pool.query(
          `
          SELECT
            id,
            customer_id,
            driver_id,
            status
          FROM rides
          WHERE id = $1
          LIMIT 1
          `,
          [rideId]
        );

      if (
        !rideResult.rows.length
      ) {

        return res.status(404).json({
          success: false,

          message:
            'Ride not found.'
        });
      }

      const ride =
        rideResult.rows[0];

      const authorized =
        ride.customer_id === req.user.id ||
        ride.driver_id === req.user.id ||
        req.user.role === 'admin' ||
        req.user.role === 'super_admin';

      if (!authorized) {

        return res.status(403).json({
          success: false,

          message:
            'You are not authorized to view this ride.'
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            ride_id,
            latitude,
            longitude,
            created_at

          FROM ride_locations

          WHERE ride_id = $1

          ORDER BY
            created_at ASC

          LIMIT 1000
          `,
          [rideId]
        );

      return res.json({
        success: true,

        locations:
          result.rows
      });

    } catch (error) {

      console.error(
        'FAGA ride location history error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Unable to load ride location history.'
      });
    }
  }
);

// ==========================================
// GET RIDE TRACKING INFORMATION
// ==========================================
//
// This gives ride-tracking.html one
// convenient endpoint containing:
//
// - ride
// - latest GPS location
// - driver
//
// ==========================================

app.get(
  '/api/rides/:rideId/tracking',
  async (req, res) => {

    const rideId =
      Number(
        req.params.rideId
      );

    if (
      !Number.isInteger(
        rideId
      ) ||
      rideId <= 0
    ) {

      return res.status(422).json({
        success: false,

        message:
          'Invalid ride ID.'
      });
    }

    try {

      const rideResult =
        await pool.query(
          `
          SELECT
            r.*,

            driver.name AS driver_name,
            driver.email AS driver_email

          FROM rides r

          LEFT JOIN users driver
            ON driver.id = r.driver_id

          WHERE r.id = $1

          LIMIT 1
          `,
          [rideId]
        );

      if (
        !rideResult.rows.length
      ) {

        return res.status(404).json({
          success: false,

          message:
            'Ride not found.'
        });
      }

      const ride =
        rideResult.rows[0];

      const authorized =
        ride.customer_id === req.user.id ||
        ride.driver_id === req.user.id ||
        req.user.role === 'admin' ||
        req.user.role === 'super_admin';

      if (!authorized) {

        return res.status(403).json({
          success: false,

          message:
            'You are not authorized to track this ride.'
        });
      }

      const locationResult =
        await pool.query(
          `
          SELECT
            id,
            ride_id,
            latitude,
            longitude,
            created_at

          FROM ride_locations

          WHERE ride_id = $1

          ORDER BY
            created_at DESC

          LIMIT 1
          `,
          [rideId]
        );

      const latestLocation =
        locationResult.rows.length
          ? locationResult.rows[0]
          : null;

      return res.json({
        success: true,

        ride,

        driver: ride.driver_id
          ? {
              id:
                ride.driver_id,

              name:
                ride.driver_name,

              email:
                ride.driver_email
            }
          : null,

        location:
          latestLocation
      });

    } catch (error) {

      console.error(
        'FAGA ride tracking error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Unable to load ride tracking information.'
      });
    }
  }
);

// =========================================================
// FAGA LIVE DRIVER GPS — RIDE LOCATION
// =========================================================
//
// This endpoint receives the driver's REAL GPS coordinates
// from the rider's device.
//
// Security:
// - Driver must be authenticated.
// - Driver must have the "rider" role.
// - Driver must actually be assigned to this ride.
// - Coordinates must be valid.
// - Very inaccurate GPS readings are rejected.
// - Impossible GPS jumps are rejected.
// - Completed/cancelled rides cannot receive GPS.
//
// =========================================================

app.post(
  '/api/rides/:id/location',
  authorizeRoles('rider'),
  async (req, res) => {

    const rideId =
      Number.parseInt(req.params.id, 10);

    const latitude =
      Number(req.body.latitude);

    const longitude =
      Number(req.body.longitude);

    const accuracy =
      Number(req.body.accuracy || 0);


    // -----------------------------------------------------
    // Validate ride ID
    // -----------------------------------------------------

    if (!Number.isInteger(rideId)) {

      return res.status(422).json({
        success: false,
        message: 'Invalid ride ID.'
      });

    }


    // -----------------------------------------------------
    // Validate GPS coordinates
    // -----------------------------------------------------

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {

      return res.status(422).json({
        success: false,
        message:
          'Valid GPS coordinates are required.'
      });

    }


    // -----------------------------------------------------
    // Validate coordinate ranges
    // -----------------------------------------------------

    if (
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {

      return res.status(422).json({
        success: false,
        message:
          'GPS coordinates are outside valid bounds.'
      });

    }


    // -----------------------------------------------------
    // Reject very poor GPS accuracy
    // -----------------------------------------------------
    //
    // accuracy is normally supplied by:
    //
    // navigator.geolocation.watchPosition()
    //
    // A value of 50 means approximately 50 metres.
    //
    // -----------------------------------------------------

    if (
      Number.isFinite(accuracy) &&
      accuracy > 200
    ) {

      return res.status(422).json({
        success: false,
        message:
          'GPS accuracy is too low. Please move to an area with a stronger GPS signal.'
      });

    }


    try {

      // ===================================================
      // VERIFY DRIVER OWNERSHIP OF THIS RIDE
      // ===================================================

      const rideResult =
        await pool.query(
          `
          SELECT
            id,
            driver_id AS "driverId",
            status
          FROM rides
          WHERE id = $1
            AND driver_id = $2
          `,
          [
            rideId,
            req.user.id
          ]
        );


      if (rideResult.rows.length === 0) {

        return res.status(403).json({
          success: false,
          message:
            'You are not assigned to this ride.'
        });

      }


      const ride =
        rideResult.rows[0];


      // ===================================================
      // DO NOT ACCEPT GPS AFTER RIDE COMPLETION
      // ===================================================

      const rideStatus =
        String(
          ride.status || ''
        ).toUpperCase();


      if (
        rideStatus === 'COMPLETED' ||
        rideStatus === 'CANCELLED'
      ) {

        return res.status(409).json({
          success: false,
          message:
            'GPS tracking is no longer active for this ride.'
        });

      }


      // ===================================================
      // GET PREVIOUS GPS LOCATION
      // ===================================================

      const previousResult =
        await pool.query(
          `
          SELECT
            latitude,
            longitude,
            created_at AS "createdAt"
          FROM ride_locations
          WHERE ride_id = $1
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [rideId]
        );


      // ===================================================
      // BASIC GPS ANOMALY PROTECTION
      // ===================================================
      //
      // We reject an impossible jump such as a driver
      // appearing several kilometres away within seconds.
      //
      // This does NOT claim to make GPS spoofing impossible.
      // It prevents obvious invalid location submissions.
      //
      // ===================================================

      if (
        previousResult.rows.length > 0
      ) {

        const previous =
          previousResult.rows[0];


        const previousLatitude =
          Number(previous.latitude);

        const previousLongitude =
          Number(previous.longitude);


        const previousTime =
          new Date(
            previous.createdAt
          ).getTime();


        const currentTime =
          Date.now();


        const elapsedHours =
          Math.max(
            (
              currentTime -
              previousTime
            ) / 3600000,
            0.001
          );


        // -----------------------------------------------
        // Haversine distance calculation
        // -----------------------------------------------

        const toRadians =
          value =>
            value * Math.PI / 180;


        const earthRadiusKm =
          6371;


        const dLatitude =
          toRadians(
            latitude -
            previousLatitude
          );


        const dLongitude =
          toRadians(
            longitude -
            previousLongitude
          );


        const a =
          Math.sin(
            dLatitude / 2
          ) ** 2
          +
          Math.cos(
            toRadians(
              previousLatitude
            )
          )
          *
          Math.cos(
            toRadians(
              latitude
            )
          )
          *
          Math.sin(
            dLongitude / 2
          ) ** 2;


        const distanceKm =
          2 *
          earthRadiusKm *
          Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
          );


        const speedKmh =
          distanceKm /
          elapsedHours;


        // -----------------------------------------------
        // FAGA maximum reasonable driving speed
        // -----------------------------------------------

        if (
          speedKmh > 180
        ) {

          console.warn(
            'FAGA rejected impossible driver GPS jump:',
            {
              rideId,
              driverId:
                req.user.id,
              speedKmh,
              latitude,
              longitude
            }
          );


          return res.status(422).json({
            success: false,
            message:
              'GPS movement appears invalid. Please retry.'
          });

        }

      }


      // ===================================================
      // SAVE REAL GPS LOCATION
      // ===================================================

      const result =
        await pool.query(
          `
          INSERT INTO ride_locations (
            ride_id,
            latitude,
            longitude
          )
          VALUES ($1, $2, $3)
          RETURNING
            latitude,
            longitude,
            created_at AS "createdAt"
          `,
          [
            rideId,
            latitude,
            longitude
          ]
        );


      // ===================================================
      // RESPONSE
      // ===================================================

      return res.json({
        success: true,
        message:
          'Driver GPS location updated.',
        driverLocation:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        'FAGA driver GPS update error:',
        error
      );


      return res.status(500).json({
        success: false,
        message:
          'Unable to update driver GPS location.'
      });

    }

  }
);

// =========================================================
// FAGA RIDER DISPATCH ENGINE
// =========================================================

// all the Part 2B code
// GET /api/rider/rides
// POST /api/rider/rides/:id/accept
// PATCH /api/rider/rides/:id/status
// PATCH /api/rider/availability

// =========================================================
// FAGA RIDER RIDE DISPATCH ENGINE
// =========================================================
//
// Production rider APIs:
//
// GET   /api/rider/rides
// POST  /api/rider/rides/:id/accept
// PATCH /api/rider/rides/:id/status
// PATCH /api/rider/availability
//
// Security:
// - Rider authentication required.
// - Rider role required.
// - Ride assignment is performed transactionally.
// - A ride cannot be accepted by two riders.
// - Rider can only update rides assigned to them.
// - Invalid status transitions are rejected.
// =========================================================


// ---------------------------------------------------------
// RIDER: GET AVAILABLE + ASSIGNED RIDES
// ---------------------------------------------------------

app.get(
  '/api/rider/rides',
  authorizeRoles('rider'),
  async (req, res) => {

    try {

      const result = await pool.query(
        `
        SELECT
          id,

          customer_id AS "customerId",

          driver_id AS "driverId",

          status,

          pickup_address AS "pickupAddress",
          pickup_latitude AS "pickupLatitude",
          pickup_longitude AS "pickupLongitude",

          destination_address AS "destinationAddress",
          destination_latitude AS "destinationLatitude",
          destination_longitude AS "destinationLongitude",

          ride_type AS "rideType",

          passengers,

          fare,

          distance_km AS "distanceKm",

          duration_minutes AS "durationMinutes",

          driver_eta_minutes AS "driverEtaMinutes",

          created_at AS "createdAt",
          updated_at AS "updatedAt"

        FROM rides

        WHERE
          (
            status IN ('SEARCHING', 'REQUESTED')
            AND driver_id IS NULL
          )

          OR

          (
            driver_id = $1
            AND status NOT IN ('COMPLETED', 'CANCELLED')
          )

        ORDER BY
          CASE
            WHEN driver_id = $1 THEN 0
            ELSE 1
          END,

          created_at ASC

        LIMIT 100
        `,
        [req.user.id]
      );

      return res.json({
        success: true,
        rides: result.rows
      });

    } catch (error) {

      console.error(
        'FAGA rider ride loading error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load rider rides.'
      });
    }
  }
);


// ---------------------------------------------------------
// RIDER: ACCEPT RIDE
// ---------------------------------------------------------

app.post(
  '/api/rider/rides/:id/accept',
  authorizeRoles('rider'),
  async (req, res) => {

    const rideId =
      Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(rideId)) {

      return res.status(422).json({
        success: false,
        message:
          'Invalid ride ID.'
      });
    }

    const client =
      await pool.connect();

    try {

      await client.query('BEGIN');


      // ---------------------------------------------------
      // Make sure this rider is available.
      // ---------------------------------------------------

      const riderResult =
        await client.query(
          `
          SELECT
            id,
            role,
            COALESCE(
              rider_available,
              FALSE
            ) AS "riderAvailable"

          FROM users

          WHERE id = $1

          FOR UPDATE
          `,
          [req.user.id]
        );

      if (
        riderResult.rows.length === 0
      ) {

        await client.query('ROLLBACK');

        return res.status(404).json({
          success: false,
          message:
            'Rider account not found.'
        });
      }


      const rider =
        riderResult.rows[0];


      if (
        rider.riderAvailable !== true
      ) {

        await client.query('ROLLBACK');

        return res.status(409).json({
          success: false,
          message:
            'You must be online before accepting a ride.'
        });
      }


      // ---------------------------------------------------
      // Lock the ride.
      //
      // This prevents two riders from accepting
      // the same ride simultaneously.
      // ---------------------------------------------------

      const rideResult =
        await client.query(
          `
          SELECT
            id,
            customer_id AS "customerId",
            driver_id AS "driverId",
            status,

            pickup_address AS "pickupAddress",
            pickup_latitude AS "pickupLatitude",
            pickup_longitude AS "pickupLongitude",

            destination_address AS "destinationAddress",
            destination_latitude AS "destinationLatitude",
            destination_longitude AS "destinationLongitude",

            ride_type AS "rideType",
            passengers,
            fare,

            distance_km AS "distanceKm",
            duration_minutes AS "durationMinutes",

            created_at AS "createdAt",
            updated_at AS "updatedAt"

          FROM rides

          WHERE id = $1

          FOR UPDATE
          `,
          [rideId]
        );


      if (
        rideResult.rows.length === 0
      ) {

        await client.query('ROLLBACK');

        return res.status(404).json({
          success: false,
          message:
            'Ride not found.'
        });
      }


      const ride =
        rideResult.rows[0];


      // ---------------------------------------------------
      // The ride must still be available.
      // ---------------------------------------------------

      const rideStatus =
        String(
          ride.status || ''
        ).toUpperCase();


      if (
        ride.driverId !== null ||
        !['SEARCHING', 'REQUESTED']
          .includes(rideStatus)
      ) {

        await client.query('ROLLBACK');

        return res.status(409).json({
          success: false,
          message:
            'This ride is no longer available.'
        });
      }


      // ---------------------------------------------------
      // Assign rider.
      // ---------------------------------------------------

      const updateResult =
        await client.query(
          `
          UPDATE rides

          SET
            driver_id = $1,
            status = 'DRIVER_ASSIGNED',
            updated_at = CURRENT_TIMESTAMP

          WHERE id = $2
            AND driver_id IS NULL
            AND status IN (
              'SEARCHING',
              'REQUESTED'
            )

          RETURNING
            id,

            customer_id AS "customerId",
            driver_id AS "driverId",

            status,

            pickup_address AS "pickupAddress",
            pickup_latitude AS "pickupLatitude",
            pickup_longitude AS "pickupLongitude",

            destination_address AS "destinationAddress",
            destination_latitude AS "destinationLatitude",
            destination_longitude AS "destinationLongitude",

            ride_type AS "rideType",
            passengers,
            fare,

            distance_km AS "distanceKm",
            duration_minutes AS "durationMinutes",
            driver_eta_minutes AS "driverEtaMinutes",

            created_at AS "createdAt",
            updated_at AS "updatedAt"
          `,
          [
            req.user.id,
            rideId
          ]
        );


      if (
        updateResult.rows.length === 0
      ) {

        await client.query('ROLLBACK');

        return res.status(409).json({
          success: false,
          message:
            'This ride was accepted by another rider.'
        });
      }


      await client.query('COMMIT');


      return res.json({
        success: true,
        message:
          'Ride accepted successfully.',
        ride:
          updateResult.rows[0]
      });

    } catch (error) {

      try {
        await client.query('ROLLBACK');
      } catch (_) {}

      console.error(
        'FAGA rider ride acceptance error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to accept this ride.'
      });

    } finally {

      client.release();
    }
  }
);


// ---------------------------------------------------------
// RIDER: UPDATE RIDE STATUS
// ---------------------------------------------------------

app.patch(
  '/api/rider/rides/:id/status',
  authorizeRoles('rider'),
  async (req, res) => {

    const rideId =
      Number.parseInt(req.params.id, 10);

    const requestedStatus =
      String(
        req.body.status || ''
      )
        .trim()
        .toUpperCase();


    if (!Number.isInteger(rideId)) {

      return res.status(422).json({
        success: false,
        message:
          'Invalid ride ID.'
      });
    }


    const allowedTransitions = {

      DRIVER_ASSIGNED:
        ['DRIVER_ARRIVING'],

      DRIVER_ARRIVING:
        ['DRIVER_ARRIVED'],

      DRIVER_ARRIVED:
        ['IN_PROGRESS'],

      IN_PROGRESS:
        ['COMPLETED']

    };


    try {

      const currentResult =
        await pool.query(
          `
          SELECT
            id,
            driver_id AS "driverId",
            status

          FROM rides

          WHERE id = $1
            AND driver_id = $2
          `,
          [
            rideId,
            req.user.id
          ]
        );


      if (
        currentResult.rows.length === 0
      ) {

        return res.status(404).json({
          success: false,
          message:
            'Ride not found or you are not assigned to it.'
        });
      }


      const currentRide =
        currentResult.rows[0];


      const currentStatus =
        String(
          currentRide.status || ''
        ).toUpperCase();


      if (
        !allowedTransitions[currentStatus]
      ) {

        return res.status(409).json({
          success: false,
          message:
            `Ride cannot move from ${currentStatus}.`
        });
      }


      if (
        !allowedTransitions[
          currentStatus
        ].includes(requestedStatus)
      ) {

        return res.status(409).json({
          success: false,
          message:
            `Invalid ride status transition: ${currentStatus} → ${requestedStatus}.`
        });
      }


      const result =
        await pool.query(
          `
          UPDATE rides

          SET
            status = $1,

            completed_at =
  CASE
    WHEN $5 = TRUE
    THEN CURRENT_TIMESTAMP
    ELSE completed_at
  END,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = $2
            AND driver_id = $3
            AND status = $4

          RETURNING
            id,

            customer_id AS "customerId",
            driver_id AS "driverId",

            status,

            pickup_address AS "pickupAddress",
            pickup_latitude AS "pickupLatitude",
            pickup_longitude AS "pickupLongitude",

            destination_address AS "destinationAddress",
            destination_latitude AS "destinationLatitude",
            destination_longitude AS "destinationLongitude",

            ride_type AS "rideType",
            passengers,
            fare,

            distance_km AS "distanceKm",
            duration_minutes AS "durationMinutes",
            driver_eta_minutes AS "driverEtaMinutes",

            created_at AS "createdAt",
            updated_at AS "updatedAt"
          `,
          [
              requestedStatus,
              rideId,
              req.user.id,
              currentStatus,
              requestedStatus === 'COMPLETED'
            ]
        );


      if (
        result.rows.length === 0
      ) {

        return res.status(409).json({
          success: false,
          message:
            'Ride status changed before your update could be saved.'
        });
      }


      return res.json({
        success: true,
        message:
          `Ride status updated to ${requestedStatus}.`,
        ride:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        'FAGA rider ride status error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to update ride status.'
      });
    }
  }
);


// ---------------------------------------------------------
// RIDER: SET ONLINE / OFFLINE
// ---------------------------------------------------------

app.patch(
  '/api/rider/availability',
  authorizeRoles('rider'),
  async (req, res) => {

    const available =
      req.body.available;


    if (
      typeof available !== 'boolean'
    ) {

      return res.status(422).json({
        success: false,
        message:
          'Availability must be true or false.'
      });
    }


    try {

      // Do not allow a rider to go offline
      // while actively carrying a ride.

      if (!available) {

        const activeRide =
          await pool.query(
            `
            SELECT id

            FROM rides

            WHERE driver_id = $1

              AND status IN (
                'DRIVER_ASSIGNED',
                'DRIVER_ARRIVING',
                'DRIVER_ARRIVED',
                'IN_PROGRESS'
              )

            LIMIT 1
            `,
            [req.user.id]
          );


        if (
          activeRide.rows.length > 0
        ) {

          return res.status(409).json({
            success: false,
            message:
              'You cannot go offline while a ride is active.'
          });
        }
      }


      const result =
        await pool.query(
          `
          UPDATE users

          SET
            rider_available = $1,
            updated_at = CURRENT_TIMESTAMP

          WHERE id = $2
            AND role = 'rider'

          RETURNING
            id,
            name,
            email,
            role,
            rider_available AS "riderAvailable"
          `,
          [
            available,
            req.user.id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({
          success: false,
          message:
            'Rider account not found.'
        });
      }


      return res.json({
        success: true,
        message:
          available
            ? 'You are now online.'
            : 'You are now offline.',
        rider:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        'FAGA rider availability error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to update rider availability.'
      });
    }
  }
);

// ==================================================
// CUSTOMER PROFILE
// ==================================================

app.get('/api/profile', (req, res) => {
  res.json(req.user);
});


app.patch('/api/profile', async (req, res) => {

  const fields =
    Object.keys(req.body);

  const values =
    Object.values(req.body);

  if (
    fields.length === 0
  ) {

    return res.status(400).json({
      error:
        'No update data provided.'
    });
  }

  /*
   * Only allow safe profile fields.
   *
   * Do NOT allow the client to modify:
   * - id
   * - role
   * - password
   * - is_active
   */

  const allowedFields = [
    'name',
    'phone'
  ];

  const safeFields =
    fields.filter(
      field =>
        allowedFields.includes(field)
    );

  if (
    safeFields.length === 0
  ) {

    return res.status(400).json({
      error:
        'No valid profile fields provided.'
    });
  }

  const safeValues =
    safeFields.map(
      field =>
        req.body[field]
    );

  const setClause =
    safeFields
      .map(
        (field, index) =>
          `${field} = $${index + 1}`
      )
      .join(', ');

  safeValues.push(
    req.user.id
  );

  try {

    const result =
      await pool.query(
        `
        UPDATE users

        SET
          ${setClause},
          updated_at = CURRENT_TIMESTAMP

        WHERE id = $${safeFields.length + 1}

        RETURNING
          id,
          name,
          email,
          phone,
          role
        `,
        safeValues
      );

    if (
      result.rows.length === 0
    ) {

      return res.status(404).json({
        error:
          'User profile not found.'
      });
    }

    return res.json({
      success: true,
      user:
        result.rows[0]
    });

  } catch (error) {

    console.error(
      'FAGA profile update error:',
      error
    );

    return res.status(400).json({
      error:
        error.message
    });
  }
});


// ==================================================
// CUSTOMER ADDRESS MANAGEMENT
// ==================================================

app.get(
  '/api/addresses',
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            id,

            address_line
              AS "addressLine",

            city,

            is_default
              AS "isDefault"

          FROM addresses

          WHERE user_id = $1

          ORDER BY
            is_default DESC,
            id DESC
          `,
          [req.user.id]
        );

      return res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        'FAGA address retrieval error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to retrieve addresses.'
      });
    }
  }
);


app.post(
  '/api/addresses',
  async (req, res) => {

    const {
      addressLine,
      city
    } = req.body;

    if (
      !addressLine ||
      !String(addressLine).trim()
    ) {

      return res.status(422).json({
        error:
          'Address is required.'
      });
    }

    try {

      const result =
        await pool.query(
          `
          INSERT INTO addresses (
            user_id,
            address_line,
            city
          )

          VALUES (
            $1,
            $2,
            $3
          )

          RETURNING
            id,

            address_line
              AS "addressLine",

            city,

            is_default
              AS "isDefault"
          `,
          [
            req.user.id,

            String(
              addressLine
            ).trim(),

            city
              ? String(city).trim()
              : null
          ]
        );

      return res.status(201).json({
        success: true,
        address:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        'FAGA address creation error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to save address.'
      });
    }
  }
);


app.patch(
  '/api/addresses/:id/default',
  async (req, res) => {

    const addressId =
      Number.parseInt(
        req.params.id,
        10
      );

    if (
      !Number.isInteger(
        addressId
      )
    ) {

      return res.status(422).json({
        error:
          'Invalid address ID.'
      });
    }

    const client =
      await pool.connect();

    try {

      await client.query(
        'BEGIN'
      );

      /*
       * Remove default status from
       * all addresses belonging to
       * this customer.
       */

      await client.query(
        `
        UPDATE addresses

        SET
          is_default = false

        WHERE user_id = $1
        `,
        [req.user.id]
      );


      /*
       * Set the selected address
       * as default.
       */

      const result =
        await client.query(
          `
          UPDATE addresses

          SET
            is_default = true

          WHERE
            id = $1

            AND user_id = $2

          RETURNING
            id,

            address_line
              AS "addressLine",

            city,

            is_default
              AS "isDefault"
          `,
          [
            addressId,
            req.user.id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(404).json({
          error:
            'Address not found.'
        });
      }


      await client.query(
        'COMMIT'
      );


      return res.json({
        success: true,

        address:
          result.rows[0]
      });

    } catch (error) {

      await client.query(
        'ROLLBACK'
      );

      console.error(
        'FAGA default address error:',
        error
      );

      return res.status(400).json({
        error:
          error.message
      });

    } finally {

      client.release();

    }
  }
);


// ==================================================
// FAGA DISPATCH DELIVERY ENGINE
// ==================================================
//
// Create a delivery request and search for
// available dispatch riders.
//
// ==================================================

app.post(
  '/api/deliveries',
  async (req, res) => {

    const {
      pickup,
      destination,
      package: packageInfo,
      recipient
    } = req.body;


    // ------------------------------------------
    // VALIDATE PICKUP
    // ------------------------------------------

    if (
      !pickup ||
      !pickup.address ||
      typeof pickup.latitude !== 'number' ||
      typeof pickup.longitude !== 'number'
    ) {

      return res.status(400).json({
        error:
          'Valid pickup address and coordinates are required.'
      });
    }


    // ------------------------------------------
    // VALIDATE DESTINATION
    // ------------------------------------------

    if (
      !destination ||
      !destination.address ||
      typeof destination.latitude !== 'number' ||
      typeof destination.longitude !== 'number'
    ) {

      return res.status(400).json({
        error:
          'Valid destination address and coordinates are required.'
      });
    }


    // ------------------------------------------
    // VALIDATE RECIPIENT
    // ------------------------------------------

    if (
      !recipient ||
      !recipient.name ||
      !recipient.phone
    ) {

      return res.status(400).json({
        error:
          'Recipient name and phone number are required.'
      });
    }


    // ------------------------------------------
    // PACKAGE INFORMATION
    // ------------------------------------------

    const packageDescription =
      packageInfo?.description ||
      'General package';

    const packageType =
      packageInfo?.type ||
      'general';

    const packageWeight =
      Number(
        packageInfo?.weight
      ) || 1;


    if (
      packageWeight <= 0
    ) {

      return res.status(400).json({
        error:
          'Package weight must be greater than zero.'
      });
    }


    // ------------------------------------------
    // COORDINATE VALIDATION
    // ------------------------------------------

    if (
      pickup.latitude < -90 ||
      pickup.latitude > 90 ||

      pickup.longitude < -180 ||
      pickup.longitude > 180 ||

      destination.latitude < -90 ||
      destination.latitude > 90 ||

      destination.longitude < -180 ||
      destination.longitude > 180
    ) {

      return res.status(400).json({
        error:
          'Invalid geographic coordinates.'
      });
    }


    // ------------------------------------------
    // HAVERSINE DISTANCE
    // ------------------------------------------

    const toRadians =
      value =>
        value *
        Math.PI /
        180;

    const earthRadiusKm =
      6371;


    const latitudeDifference =
      toRadians(
        destination.latitude -
        pickup.latitude
      );


    const longitudeDifference =
      toRadians(
        destination.longitude -
        pickup.longitude
      );


    const a =
      Math.sin(
        latitudeDifference / 2
      ) ** 2 +

      Math.cos(
        toRadians(
          pickup.latitude
        )
      ) *

      Math.cos(
        toRadians(
          destination.latitude
        )
      ) *

      Math.sin(
        longitudeDifference / 2
      ) ** 2;


    const distanceKm =
      earthRadiusKm *
      2 *
      Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
      );


    // ------------------------------------------
    // SERVER-SIDE DELIVERY PRICING
    // ------------------------------------------

    const baseFare =
      1500;

    const perKm =
      250;


    const calculatedFee =
      baseFare +
      (
        distanceKm *
        perKm
      );


    const deliveryFee =
      Math.round(
        calculatedFee / 50
      ) * 50;


    // ------------------------------------------
    // TRANSACTION
    // ------------------------------------------

    const client =
      await pool.connect();

    try {

      await client.query(
        'BEGIN'
      );


      // ----------------------------------------
      // CREATE DELIVERY
      // ----------------------------------------

      const deliveryResult =
        await client.query(
          `
          INSERT INTO deliveries (

            customer_id,

            status,

            pickup_address,
            pickup_latitude,
            pickup_longitude,

            dropoff_address,
            dropoff_latitude,
            dropoff_longitude,

            package_description,
            package_type,
            package_weight,

            recipient_name,
            recipient_phone,

            distance_km,
            delivery_fee,

            requested_at,
            updated_at

          )

          VALUES (

            $1,
            'PENDING',

            $2,
            $3,
            $4,

            $5,
            $6,
            $7,

            $8,
            $9,
            $10,

            $11,
            $12,

            $13,
            $14,

            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )

          RETURNING

            id,

            customer_id
              AS "customerId",

            status,

            pickup_address
              AS "pickupAddress",

            pickup_latitude
              AS "pickupLatitude",

            pickup_longitude
              AS "pickupLongitude",

            dropoff_address
              AS "dropoffAddress",

            dropoff_latitude
              AS "dropoffLatitude",

            dropoff_longitude
              AS "dropoffLongitude",

            package_description
              AS "packageDescription",

            package_type
              AS "packageType",

            package_weight
              AS "packageWeight",

            recipient_name
              AS "recipientName",

            recipient_phone
              AS "recipientPhone",

            distance_km
              AS "distanceKm",

            delivery_fee
              AS "deliveryFee",

            requested_at
              AS "requestedAt"
          `,

          [
            req.user.id,

            String(
              pickup.address
            ).trim(),

            pickup.latitude,
            pickup.longitude,

            String(
              destination.address
            ).trim(),

            destination.latitude,
            destination.longitude,

            packageDescription,

            packageType,

            packageWeight,

            String(
              recipient.name
            ).trim(),

            String(
              recipient.phone
            ).trim(),

            Number(
              distanceKm.toFixed(2)
            ),

            deliveryFee
          ]
        );


      const delivery =
        deliveryResult.rows[0];


      // ----------------------------------------
      // FIND AVAILABLE RIDERS
      // ----------------------------------------

      const ridersResult =
        await client.query(
          `
          SELECT
            id,
            name,
            email

          FROM users

          WHERE
            role = 'rider'

            AND is_active = true

            AND id <> $1

          ORDER BY
            id ASC

          LIMIT 10
          `,
          [req.user.id]
        );


      // ----------------------------------------
      // CREATE RIDER OFFERS
      // ----------------------------------------

      for (
        const rider
        of ridersResult.rows
      ) {

        await client.query(
          `
          INSERT INTO delivery_matches (
            delivery_id,
            rider_id,
            status
          )

          VALUES (
            $1,
            $2,
            'OFFERED'
          )

          ON CONFLICT (
            delivery_id,
            rider_id
          )

          DO NOTHING
          `,
          [
            delivery.id,
            rider.id
          ]
        );
      }


      await client.query(
        'COMMIT'
      );


      return res.status(201).json({

        success: true,

        message:
          ridersResult.rows.length > 0
            ? 'Delivery request created. Searching for a dispatch rider.'
            : 'Delivery request created. No available rider was found yet.',

        delivery,

        ridersContacted:
          ridersResult.rows.length

      });


    } catch (error) {

      await client.query(
        'ROLLBACK'
      );

      console.error(
        'FAGA delivery creation error:',
        error
      );

      return res.status(500).json({

        error:
          'Unable to create delivery request.',

        details:
          process.env.NODE_ENV === 'production'
            ? undefined
            : error.message

      });

    } finally {

      client.release();

    }
  }
);


// ==================================================
// GET MY DELIVERIES
// ==================================================

app.get(
  '/api/deliveries',
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT

            id,

            customer_id
              AS "customerId",

            rider_id
              AS "riderId",

            status,

            pickup_address
              AS "pickupAddress",

            pickup_latitude
              AS "pickupLatitude",

            pickup_longitude
              AS "pickupLongitude",

            dropoff_address
              AS "dropoffAddress",

            dropoff_latitude
              AS "dropoffLatitude",

            dropoff_longitude
              AS "dropoffLongitude",

            package_description
              AS "packageDescription",

            package_type
              AS "packageType",

            package_weight
              AS "packageWeight",

            recipient_name
              AS "recipientName",

            recipient_phone
              AS "recipientPhone",

            distance_km
              AS "distanceKm",

            delivery_fee
              AS "deliveryFee",

            requested_at
              AS "requestedAt",

            accepted_at
              AS "acceptedAt",

            picked_up_at
              AS "pickedUpAt",

            delivered_at
              AS "deliveredAt",

            cancelled_at
              AS "cancelledAt"

          FROM deliveries

          WHERE customer_id = $1

          ORDER BY
            created_at DESC
          `,
          [req.user.id]
        );


      return res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        'FAGA delivery history error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to retrieve deliveries.'
      });
    }
  }
);


// ==================================================
// GET ONE DELIVERY
// ==================================================

app.get(
  '/api/deliveries/:id',
  async (req, res) => {

    const deliveryId =
      Number.parseInt(
        req.params.id,
        10
      );


    if (
      !Number.isInteger(
        deliveryId
      )
    ) {

      return res.status(400).json({
        error:
          'Invalid delivery ID.'
      });
    }


    try {

      const result =
        await pool.query(
          `
          SELECT

            d.*,

            u.name
              AS "riderName",

            u.email
              AS "riderEmail"

          FROM deliveries d

          LEFT JOIN users u
            ON u.id = d.rider_id

          WHERE
            d.id = $1

            AND (
              d.customer_id = $2
              OR d.rider_id = $2
            )
          `,
          [
            deliveryId,
            req.user.id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({
          error:
            'Delivery not found.'
        });
      }


      return res.json(
        result.rows[0]
      );

    } catch (error) {

      console.error(
        'FAGA delivery lookup error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to retrieve delivery.'
      });
    }
  }
);


// ==================================================
// RIDER: VIEW DELIVERY OFFERS
// ==================================================

app.get(
  '/api/rider/delivery-offers',

  authorizeRoles('rider'),

  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT

            dm.id
              AS "matchId",

            dm.delivery_id
              AS "deliveryId",

            dm.status
              AS "matchStatus",

            dm.offered_at
              AS "offeredAt",

            d.pickup_address
              AS "pickupAddress",

            d.dropoff_address
              AS "dropoffAddress",

            d.pickup_latitude
              AS "pickupLatitude",

            d.pickup_longitude
              AS "pickupLongitude",

            d.dropoff_latitude
              AS "dropoffLatitude",

            d.dropoff_longitude
              AS "dropoffLongitude",

            d.package_description
              AS "packageDescription",

            d.package_type
              AS "packageType",

            d.package_weight
              AS "packageWeight",

            d.distance_km
              AS "distanceKm",

            d.delivery_fee
              AS "deliveryFee",

            u.name
              AS "customerName"

          FROM delivery_matches dm

          INNER JOIN deliveries d
            ON d.id = dm.delivery_id

          INNER JOIN users u
            ON u.id = d.customer_id

          WHERE
            dm.rider_id = $1

            AND dm.status = 'OFFERED'

            AND d.status = 'PENDING'

          ORDER BY
            dm.offered_at DESC
          `,
          [req.user.id]
        );


      return res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        'FAGA rider delivery offers error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to retrieve delivery offers.'
      });
    }
  }
);


// ==================================================
// RIDER: ACCEPT DELIVERY
// ==================================================

app.post(
  '/api/rider/deliveries/:id/accept',

  authorizeRoles('rider'),

  async (req, res) => {

    const deliveryId =
      Number.parseInt(
        req.params.id,
        10
      );


    if (
      !Number.isInteger(
        deliveryId
      )
    ) {

      return res.status(400).json({
        error:
          'Invalid delivery ID.'
      });
    }


    const client =
      await pool.connect();


    try {

      await client.query(
        'BEGIN'
      );


      /*
       * Lock the delivery row.
       *
       * This prevents two riders from
       * accepting the same delivery at
       * exactly the same time.
       */

      const deliveryResult =
        await client.query(
          `
          SELECT
            id,
            status

          FROM deliveries

          WHERE id = $1

          FOR UPDATE
          `,
          [deliveryId]
        );


      if (
        deliveryResult.rows.length === 0
      ) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(404).json({
          error:
            'Delivery not found.'
        });
      }


      const delivery =
        deliveryResult.rows[0];


      if (
        delivery.status !== 'PENDING'
      ) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(409).json({
          error:
            'This delivery is no longer available.'
        });
      }


      /*
       * Confirm that this specific
       * rider actually received the offer.
       */

      const matchResult =
        await client.query(
          `
          SELECT
            id

          FROM delivery_matches

          WHERE
            delivery_id = $1

            AND rider_id = $2

            AND status = 'OFFERED'

          FOR UPDATE
          `,
          [
            deliveryId,
            req.user.id
          ]
        );


      if (
        matchResult.rows.length === 0
      ) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(403).json({
          error:
            'This delivery offer is not available to you.'
        });
      }


      // ----------------------------------------
      // ASSIGN RIDER
      // ----------------------------------------

      const updateResult =
        await client.query(
          `
          UPDATE deliveries

          SET

            rider_id = $1,

            status = 'ASSIGNED',

            accepted_at =
              CURRENT_TIMESTAMP,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = $2

          RETURNING *
          `,
          [
            req.user.id,
            deliveryId
          ]
        );


      // ----------------------------------------
      // MARK THIS OFFER ACCEPTED
      // ----------------------------------------

      await client.query(
        `
        UPDATE delivery_matches

        SET

          status = 'ACCEPTED',

          responded_at =
            CURRENT_TIMESTAMP

        WHERE
          delivery_id = $1

          AND rider_id = $2
        `,
        [
          deliveryId,
          req.user.id
        ]
      );


      // ----------------------------------------
      // EXPIRE OTHER RIDER OFFERS
      // ----------------------------------------

      await client.query(
        `
        UPDATE delivery_matches

        SET

          status = 'EXPIRED',

          responded_at =
            CURRENT_TIMESTAMP

        WHERE
          delivery_id = $1

          AND rider_id <> $2

          AND status = 'OFFERED'
        `,
        [
          deliveryId,
          req.user.id
        ]
      );


      await client.query(
        'COMMIT'
      );


      return res.json({

        success: true,

        message:
          'Delivery accepted successfully.',

        delivery:
          updateResult.rows[0]

      });


    } catch (error) {

      await client.query(
        'ROLLBACK'
      );

      console.error(
        'FAGA delivery acceptance error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to accept delivery.'
      });

    } finally {

      client.release();

    }
  }
);


// ==================================================
// RIDER: DECLINE DELIVERY
// ==================================================

app.post(
  '/api/rider/deliveries/:id/decline',

  authorizeRoles('rider'),

  async (req, res) => {

    const deliveryId =
      Number.parseInt(
        req.params.id,
        10
      );


    if (
      !Number.isInteger(
        deliveryId
      )
    ) {

      return res.status(400).json({
        error:
          'Invalid delivery ID.'
      });
    }


    try {

      const result =
        await pool.query(
          `
          UPDATE delivery_matches

          SET

            status = 'DECLINED',

            responded_at =
              CURRENT_TIMESTAMP

          WHERE

            delivery_id = $1

            AND rider_id = $2

            AND status = 'OFFERED'

          RETURNING

            id,

            delivery_id
              AS "deliveryId",

            status
          `,
          [
            deliveryId,
            req.user.id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({
          error:
            'Active delivery offer not found.'
        });
      }


      return res.json({

        success: true,

        message:
          'Delivery offer declined.',

        match:
          result.rows[0]

      });


    } catch (error) {

      console.error(
        'FAGA delivery decline error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to decline delivery.'
      });
    }
  }
);


// ==================================================
// ADMIN: ASSIGN RIDER TO DELIVERY
// ==================================================

app.patch(
  '/api/deliveries/:id/assign-rider',

  authorizeRoles('admin'),

  async (req, res) => {

    const riderId =
      Number.parseInt(
        req.body.riderId,
        10
      );

    const deliveryId =
      Number.parseInt(
        req.params.id,
        10
      );


    if (
      !Number.isInteger(
        riderId
      ) ||
      !Number.isInteger(
        deliveryId
      )
    ) {

      return res.status(422).json({
        error:
          'Valid rider ID and delivery ID are required.'
      });
    }


    try {

      const result =
        await pool.query(
          `
          UPDATE deliveries

          SET

            rider_id = $1,

            status = 'ASSIGNED',

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = $2

          RETURNING

            id,

            customer_id
              AS "customerId",

            rider_id
              AS "riderId",

            status,

            pickup_address
              AS "pickupAddress",

            dropoff_address
              AS "dropoffAddress"
          `,
          [
            riderId,
            deliveryId
          ]
        );


      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({
          error:
            'Delivery not found.'
        });
      }


      return res.json({
        success: true,

        delivery:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        'FAGA admin delivery assignment error:',
        error
      );

      return res.status(400).json({
        error:
          error.message
      });
    }
  }
);
// ==================================================
// LIVE RIDER TELEMETRY
// ==================================================

app.post(
  '/api/telemetry/update',
  authorizeRoles('rider', 'admin'),
  async (req, res) => {

    const {
      ride_id,
      latitude,
      longitude
    } = req.body;

    const rideId =
      Number.parseInt(
        ride_id,
        10
      );

    const lat =
      Number(latitude);

    const lng =
      Number(longitude);

    if (
      !Number.isInteger(rideId) ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {

      return res.status(422).json({
        error:
          'Valid ride ID, latitude and longitude are required.'
      });
    }

    if (
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {

      return res.status(422).json({
        error:
          'Invalid geographic coordinates.'
      });
    }

    try {

      const result =
        await pool.query(
          `
          INSERT INTO telemetries (
            delivery_id,
            latitude,
            longitude
          )

          VALUES (
            $1,
            $2,
            $3
          )

          RETURNING
            id,
            delivery_id AS "deliveryId",
            latitude,
            longitude,
            created_at AS "createdAt"
          `,
          [
            rideId,
            lat,
            lng
          ]
        );

      return res.json({

        success: true,

        message:
          'Coordinates buffered successfully.',

        data:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        'FAGA telemetry update error:',
        error
      );

      return res.status(400).json({
        error:
          'Failed to stream location metrics to data buffers.'
      });
    }
  }
);


// ==================================================
// ADMIN: APPROVE RIDER APPLICATION
// ==================================================

app.post(
  '/api/admin/rider-applications/:id/approve',

  authorizeRoles('admin'),

  async (req, res) => {

    const applicationId =
      Number.parseInt(
        req.params.id,
        10
      );

    if (
      !Number.isInteger(
        applicationId
      )
    ) {

      return res.status(422).json({
        error:
          'Invalid rider application ID.'
      });
    }

    const client =
      await pool.connect();

    try {

      await client.query(
        'BEGIN'
      );

      const applicationResult =
        await client.query(
          `
          UPDATE rider_applications

          SET
            status = 'approved'

          WHERE id = $1

          RETURNING
            user_id
          `,
          [applicationId]
        );

      if (
        applicationResult.rows.length === 0
      ) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(404).json({
          error:
            'Rider application entry not found.'
        });
      }

      const userId =
        applicationResult.rows[0].user_id;

      await client.query(
        `
        UPDATE users

        SET
          role = 'rider',
          is_active = true,
          updated_at = CURRENT_TIMESTAMP

        WHERE id = $1
        `,
        [userId]
      );

      await client.query(
        'COMMIT'
      );

      return res.json({

        success: true,

        message:
          'Rider application approved and rider access activated.'

      });

    } catch (error) {

      await client.query(
        'ROLLBACK'
      );

      console.error(
        'Rider approval error:',
        error
      );

      return res.status(400).json({
        error:
          error.message
      });

    } finally {

      client.release();

    }
  }
);


// ==================================================
// FINANCIAL / WALLET
// ==================================================

// ------------------------------------------
// GET WALLET + TRANSACTIONS
// ------------------------------------------

app.get(
  '/api/finance/wallet',
  async (req, res) => {

    try {

      let walletResult =
        await pool.query(
          `
          SELECT
            id,
            balance

          FROM wallets

          WHERE user_id = $1
          `,
          [req.user.id]
        );


      if (
        walletResult.rows.length === 0
      ) {

        walletResult =
          await pool.query(
            `
            INSERT INTO wallets (
              user_id,
              balance
            )

            VALUES (
              $1,
              0.00
            )

            RETURNING
              id,
              balance
            `,
            [req.user.id]
          );
      }


      const wallet =
        walletResult.rows[0];


      const transactionsResult =
        await pool.query(
          `
          SELECT

            id,

            amount,

            type,

            status,

            description,

            payment_provider
              AS "paymentProvider",

            payment_reference
              AS "paymentReference",

            created_at
              AS "createdAt"

          FROM transactions

          WHERE wallet_id = $1

          ORDER BY
            created_at DESC

          LIMIT 20
          `,
          [wallet.id]
        );


      return res.json({

        success: true,

        balance:
          Number(wallet.balance),

        transactions:
          transactionsResult.rows

      });

    } catch (error) {

      console.error(
        'Wallet retrieval error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to retrieve wallet information.'
      });
    }
  }
);


// ------------------------------------------
// INITIALIZE PAYSTACK DEPOSIT
// ------------------------------------------

app.post(
  '/api/finance/deposit',
  async (req, res) => {

    const amount =
      Number(req.body.amount);


    if (
      !Number.isFinite(amount) ||
      amount < 100
    ) {

      return res.status(400).json({
        error:
          'Minimum wallet funding amount is ₦100.'
      });
    }


    if (
      !process.env.PAYSTACK_SECRET_KEY
    ) {

      return res.status(500).json({
        error:
          'Payment provider is not configured.'
      });
    }


    const client =
      await pool.connect();


    try {

      const userResult =
        await client.query(
          `
          SELECT
            id,
            name,
            email

          FROM users

          WHERE id = $1
          `,
          [req.user.id]
        );


      if (
        userResult.rows.length === 0
      ) {

        return res.status(404).json({
          error:
            'Customer account not found.'
        });
      }


      const user =
        userResult.rows[0];


      let walletResult =
        await client.query(
          `
          SELECT
            id

          FROM wallets

          WHERE user_id = $1
          `,
          [req.user.id]
        );


      if (
        walletResult.rows.length === 0
      ) {

        walletResult =
          await client.query(
            `
            INSERT INTO wallets (
              user_id,
              balance
            )

            VALUES (
              $1,
              0.00
            )

            RETURNING id
            `,
            [req.user.id]
          );
      }


      const walletId =
        walletResult.rows[0].id;


      const amountInKobo =
        Math.round(
          amount * 100
        );


      const reference =
        `FAGA-WALLET-${req.user.id}-${Date.now()}-${crypto.randomUUID()}`;


      const transactionResult =
        await client.query(
          `
          INSERT INTO transactions (

            wallet_id,

            amount,

            type,

            status,

            description,

            payment_provider,

            payment_reference

          )

          VALUES (
            $1,
            $2,
            'DEPOSIT',
            'PENDING',
            $3,
            'paystack',
            $4
          )

          RETURNING

            id,

            amount,

            type,

            status,

            description,

            payment_provider
              AS "paymentProvider",

            payment_reference
              AS "paymentReference",

            created_at
              AS "createdAt"
          `,
          [
            walletId,

            amount,

            'FAGA Wallet Funding via Paystack',

            reference
          ]
        );


      try {

        const paystackResponse =
          await axios.post(
            'https://api.paystack.co/transaction/initialize',

            {
              email:
                user.email,

              amount:
                amountInKobo,

              reference,

              callback_url:
                process.env.PAYSTACK_CALLBACK_URL ||
                'https://faga-frontend-portal.vercel.app/user-portal/dashboard.html',

              metadata: {

                userId:
                  req.user.id,

                walletId,

                transactionId:
                  transactionResult.rows[0].id,

                amount

              }
            },

            {
              headers: {

                Authorization:
                  `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

                'Content-Type':
                  'application/json'

              },

              timeout:
                15000
            }
          );


        if (
          !paystackResponse.data ||
          !paystackResponse.data.status ||
          !paystackResponse.data.data
        ) {

          throw new Error(
            paystackResponse.data?.message ||
            'Paystack payment initialization failed.'
          );
        }


        return res.status(201).json({

          success: true,

          message:
            'Payment initialized successfully.',

          authorizationUrl:
            paystackResponse.data.data.authorization_url,

          accessCode:
            paystackResponse.data.data.access_code,

          reference:
            paystackResponse.data.data.reference,

          transaction:
            transactionResult.rows[0]

        });

      } catch (paystackError) {

        await client.query(
          `
          UPDATE transactions

          SET
            status = 'FAILED'

          WHERE id = $1
          `,
          [
            transactionResult.rows[0].id
          ]
        );


        console.error(
          'Paystack initialization error:',
          paystackError.response?.data ||
          paystackError.message
        );


        return res.status(502).json({
          error:
            paystackError.response?.data?.message ||
            'Unable to initialize Paystack payment.'
        });
      }

    } catch (error) {

      console.error(
        'Wallet funding initialization error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to initialize wallet funding.'
      });

    } finally {

      client.release();

    }
  }
);


// ------------------------------------------
// VERIFY PAYSTACK DEPOSIT
// ------------------------------------------

app.get(
  '/api/finance/deposit/verify/:reference',

  async (req, res) => {

    const {
      reference
    } = req.params;


    if (!reference) {

      return res.status(400).json({
        error:
          'Payment reference is required.'
      });
    }


    if (
      !process.env.PAYSTACK_SECRET_KEY
    ) {

      return res.status(500).json({
        error:
          'Payment provider is not configured.'
      });
    }


    try {

      const paystackResponse =
        await axios.get(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,

          {
            headers: {

              Authorization:
                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`

            },

            timeout:
              15000
          }
        );


      const payment =
        paystackResponse.data?.data;


      if (!payment) {

        return res.status(502).json({
          error:
            'Invalid response from payment provider.'
        });
      }


      const transactionResult =
        await pool.query(
          `
          SELECT

            t.id,

            t.wallet_id
              AS "walletId",

            t.amount,

            t.status,

            t.payment_reference
              AS "paymentReference",

            w.user_id
              AS "userId"

          FROM transactions t

          INNER JOIN wallets w
            ON w.id = t.wallet_id

          WHERE
            t.payment_provider = 'paystack'

            AND t.payment_reference = $1
          `,
          [reference]
        );


      if (
        transactionResult.rows.length === 0
      ) {

        return res.status(404).json({
          error:
            'FAGA payment transaction not found.'
        });
      }


      const transaction =
        transactionResult.rows[0];


      if (
        Number(transaction.userId) !==
        Number(req.user.id)
      ) {

        return res.status(403).json({
          error:
            'You are not authorized to verify this payment.'
        });
      }


      const expectedAmountInKobo =
        Math.round(
          Number(transaction.amount) *
          100
        );


      if (
        payment.currency !== 'NGN' ||
        Number(payment.amount) !==
          expectedAmountInKobo
      ) {

        return res.status(400).json({
          error:
            'Payment amount or currency does not match the FAGA transaction.'
        });
      }


      if (
        payment.status !== 'success'
      ) {

        await pool.query(
          `
          UPDATE transactions

          SET
            status = 'FAILED'

          WHERE
            id = $1

            AND status = 'PENDING'
          `,
          [transaction.id]
        );


        return res.status(400).json({

          error:
            'Payment was not successful.',

          paymentStatus:
            payment.status

        });
      }


      const client =
        await pool.connect();


      try {

        await client.query(
          'BEGIN'
        );


        const lockedTransaction =
          await client.query(
            `
            SELECT

              id,

              wallet_id,

              amount,

              status

            FROM transactions

            WHERE id = $1

            FOR UPDATE
            `,
            [transaction.id]
          );


        const currentTransaction =
          lockedTransaction.rows[0];


        if (!currentTransaction) {

          await client.query(
            'ROLLBACK'
          );

          return res.status(404).json({
            error:
              'FAGA transaction no longer exists.'
          });
        }


        /*
         * Idempotency protection.
         *
         * If the user refreshes the
         * verification URL, the wallet
         * must NOT be credited twice.
         */

        if (
          currentTransaction.status ===
          'COMPLETED'
        ) {

          await client.query(
            'COMMIT'
          );

          return res.json({

            success: true,

            message:
              'Payment already verified and wallet credited.',

            reference,

            status:
              'COMPLETED',

            amount:
              Number(
                currentTransaction.amount
              )

          });
        }


        if (
          currentTransaction.status !==
          'PENDING'
        ) {

          await client.query(
            'ROLLBACK'
          );

          return res.status(400).json({

            error:
              'This payment transaction is no longer pending.',

            status:
              currentTransaction.status

          });
        }


        await client.query(
          `
          UPDATE wallets

          SET

            balance =
              balance + $1,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = $2
          `,
          [
            Number(
              currentTransaction.amount
            ),

            currentTransaction.wallet_id
          ]
        );


        const completedTransaction =
          await client.query(
            `
            UPDATE transactions

            SET
              status = 'COMPLETED'

            WHERE id = $1

            RETURNING

              id,

              amount,

              type,

              status,

              description,

              payment_provider
                AS "paymentProvider",

              payment_reference
                AS "paymentReference",

              created_at
                AS "createdAt"
            `,
            [
              currentTransaction.id
            ]
          );


        await client.query(
          'COMMIT'
        );


        return res.json({

          success: true,

          message:
            'Payment verified and wallet funded successfully.',

          reference,

          status:
            'COMPLETED',

          transaction:
            completedTransaction.rows[0]

        });

      } catch (error) {

        await client.query(
          'ROLLBACK'
        );

        throw error;

      } finally {

        client.release();

      }

    } catch (error) {

      console.error(
        'Paystack verification error:',
        error.response?.data ||
        error.message
      );

      return res.status(502).json({
        error:
          error.response?.data?.message ||
          'Unable to verify payment with Paystack.'
      });
    }
  }
);


// ==================================================
// SELLER APPLICATION MANAGEMENT
// ==================================================

// ------------------------------------------
// SUBMIT SELLER APPLICATION
// ------------------------------------------

app.post(
  '/api/seller-applications',
  async (req, res) => {

    const {
      storeName,
      businessAddress
    } = req.body;


    if (
      !storeName ||
      !businessAddress
    ) {

      return res.status(400).json({
        error:
          'Store name and business address are required parameters.'
      });
    }


    try {

      const result =
        await pool.query(
          `
          INSERT INTO seller_applications (
            user_id,
            store_name,
            business_address
          )

          VALUES (
            $1,
            $2,
            $3
          )

          RETURNING

            id,

            user_id
              AS "userId",

            store_name
              AS "storeName",

            status,

            created_at
              AS "createdAt"
          `,
          [
            req.user.id,
            storeName,
            businessAddress
          ]
        );


      return res.status(201).json(
        result.rows[0]
      );

    } catch (error) {

      console.error(
        'Seller application error:',
        error
      );

      return res.status(400).json({
        error:
          'You have already submitted an active seller application.'
      });
    }
  }
);


// ------------------------------------------
// GET MY SELLER APPLICATION
// ------------------------------------------

app.get(
  '/api/seller-applications/me',
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT

            id,

            store_name
              AS "storeName",

            business_address
              AS "businessAddress",

            status,

            created_at
              AS "createdAt"

          FROM seller_applications

          WHERE user_id = $1

          ORDER BY
            created_at DESC

          LIMIT 1
          `,
          [req.user.id]
        );


      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({
          message:
            'No seller application profiles found.'
        });
      }


      return res.json(
        result.rows[0]
      );

    } catch (error) {

      return res.status(500).json({
        error:
          error.message
      });
    }
  }
);


// ------------------------------------------
// ADMIN: LIST SELLER APPLICATIONS
// ------------------------------------------

app.get(
  '/api/admin/seller-applications',

  authorizeRoles('admin'),

  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT

            id,

            user_id
              AS "userId",

            store_name
              AS "storeName",

            business_address
              AS "businessAddress",

            status,

            created_at
              AS "createdAt"

          FROM seller_applications

          ORDER BY
            created_at DESC
          `
        );


      return res.json(
        result.rows
      );

    } catch (error) {

      return res.status(500).json({
        error:
          error.message
      });
    }
  }
);


// ------------------------------------------
// ADMIN: APPROVE SELLER
// ------------------------------------------

app.post(
  '/api/admin/seller-applications/:id/approve',

  authorizeRoles('admin'),

  async (req, res) => {

    const applicationId =
      Number.parseInt(
        req.params.id,
        10
      );


    const client =
      await pool.connect();


    try {

      await client.query(
        'BEGIN'
      );


      const appUpdate =
        await client.query(
          `
          UPDATE seller_applications

          SET
            status = 'approved'

          WHERE id = $1

          RETURNING

            user_id,
            store_name,
            business_address
          `,
          [applicationId]
        );


      if (
        appUpdate.rows.length === 0
      ) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(404).json({
          error:
            'Seller application entry not found.'
        });
      }


      const application =
        appUpdate.rows[0];


      await client.query(
        `
        UPDATE users

        SET

          role = 'seller',

          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = $1
        `,
        [
          application.user_id
        ]
      );


      await client.query(
        `
        INSERT INTO seller_profiles (
          user_id,
          store_name,
          business_address
        )

        VALUES (
          $1,
          $2,
          $3
        )

        ON CONFLICT (
          user_id
        )

        DO NOTHING
        `,
        [
          application.user_id,
          application.store_name,
          application.business_address
        ]
      );


      await client.query(
        'COMMIT'
      );


      return res.json({

        success: true,

        message:
          'Seller application approved. User profile role successfully elevated to seller.'

      });

    } catch (error) {

      await client.query(
        'ROLLBACK'
      );

      console.error(
        'Seller approval error:',
        error
      );

      return res.status(500).json({
        error:
          error.message
      });

    } finally {

      client.release();

    }
  }
);


// ==================================================
// JOB BOARD
// ==================================================

// ------------------------------------------
// PUBLIC JOB LIST
// ------------------------------------------

app.get(
  '/api/jobs',
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT

            id,

            title,

            description,

            status,

            created_at
              AS "createdAt"

          FROM jobs

          WHERE status = 'open'

          ORDER BY
            created_at DESC
          `
        );


      return res.json(
        result.rows
      );

    } catch (error) {

      return res.status(500).json({
        error:
          error.message
      });
    }
  }
);


// ------------------------------------------
// PUBLIC SINGLE JOB
// ------------------------------------------

app.get(
  '/api/jobs/:id',
  async (req, res) => {

    const jobId =
      Number.parseInt(
        req.params.id,
        10
      );


    if (
      !Number.isInteger(jobId)
    ) {

      return res.status(422).json({
        error:
          'Invalid job ID.'
      });
    }


    try {

      const result =
        await pool.query(
          `
          SELECT

            id,

            title,

            description,

            status,

            created_at
              AS "createdAt"

          FROM jobs

          WHERE id = $1
          `,
          [jobId]
        );


      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({
          message:
            'Requested job posting profile not found.'
        });
      }


      return res.json(
        result.rows[0]
      );

    } catch (error) {

      return res.status(500).json({
        error:
          error.message
      });
    }
  }
);


// ------------------------------------------
// ADMIN: CREATE JOB
// ------------------------------------------

app.post(
  '/api/jobs',
  authorizeRoles('admin'),
  async (req, res) => {

    const {
      title,
      description
    } = req.body;


    if (
      !title ||
      !description
    ) {

      return res.status(400).json({
        error:
          'Job title and description are required.'
      });
    }


    try {

      const result =
        await pool.query(
          `
          INSERT INTO jobs (
            title,
            description
          )

          VALUES (
            $1,
            $2
          )

          RETURNING

            id,
            title,
            description,
            status,

            created_at
              AS "createdAt"
          `,
          [
            title,
            description
          ]
        );


      return res.status(201).json(
        result.rows[0]
      );

    } catch (error) {

      return res.status(500).json({
        error:
          error.message
      });
    }
  }
);


// ------------------------------------------
// ADMIN: CLOSE JOB
// ------------------------------------------

app.patch(
  '/api/jobs/:id/close',
  authorizeRoles('admin'),
  async (req, res) => {

    const jobId =
      Number.parseInt(
        req.params.id,
        10
      );


    if (
      !Number.isInteger(jobId)
    ) {

      return res.status(422).json({
        error:
          'Invalid job ID.'
      });
    }


    try {

      const result =
        await pool.query(
          `
          UPDATE jobs

          SET
            status = 'closed'

          WHERE id = $1

          RETURNING
            id,
            title,
            status
          `,
          [jobId]
        );


      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({
          error:
            'Target job item reference not found.'
        });
      }


      return res.json({

        success: true,

        message:
          'Job entry marked closed successfully.',

        job:
          result.rows[0]

      });

    } catch (error) {

      return res.status(500).json({
        error:
          error.message
      });
    }
  }
);


// ==================================================
// DELIVERY LIFECYCLE
// ==================================================

async function getAuthorizedDelivery(
  deliveryId,
  userId
) {

  const result =
    await pool.query(
      `
      SELECT

        d.*,

        u.name
          AS "riderName",

        u.email
          AS "riderEmail"

      FROM deliveries d

      LEFT JOIN users u
        ON u.id = d.rider_id

      WHERE
        d.id = $1

        AND (
          d.customer_id = $2
          OR d.rider_id = $2
        )
      `,
      [
        deliveryId,
        userId
      ]
    );


  return (
    result.rows[0] ||
    null
  );
}


// ==================================================
// RIDER: MARK PACKAGE PICKED UP
// ==================================================

app.post(
  '/api/rider/deliveries/:id/pickup',

  authorizeRoles('rider'),

  async (req, res) => {

    const deliveryId =
      Number.parseInt(
        req.params.id,
        10
      );


    if (
      !Number.isInteger(
        deliveryId
      )
    ) {

      return res.status(400).json({
        error:
          'Invalid delivery ID.'
      });
    }


    try {

      const result =
        await pool.query(
          `
          UPDATE deliveries

          SET

            status = 'PICKED_UP',

            picked_up_at =
              CURRENT_TIMESTAMP,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE
            id = $1

            AND rider_id = $2

            AND status = 'ASSIGNED'

          RETURNING *
          `,
          [
            deliveryId,
            req.user.id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        const delivery =
          await getAuthorizedDelivery(
            deliveryId,
            req.user.id
          );


        if (!delivery) {

          return res.status(404).json({
            error:
              'Delivery not found.'
          });
        }


        return res.status(409).json({
          error:
            `Delivery cannot be marked as picked up from its current status: ${delivery.status}.`
        });
      }


      return res.json({

        success: true,

        message:
          'Package marked as picked up.',

        delivery:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        'Pickup update error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to update pickup status.'
      });
    }
  }
);


// ==================================================
// RIDER: START DELIVERY / TRANSIT
// ==================================================

app.post(
  '/api/rider/deliveries/:id/start',

  authorizeRoles('rider'),

  async (req, res) => {

    const deliveryId =
      Number.parseInt(
        req.params.id,
        10
      );


    if (
      !Number.isInteger(
        deliveryId
      )
    ) {

      return res.status(400).json({
        error:
          'Invalid delivery ID.'
      });
    }


    try {

      const result =
        await pool.query(
          `
          UPDATE deliveries

          SET

            status = 'IN_TRANSIT',

            updated_at =
              CURRENT_TIMESTAMP

          WHERE
            id = $1

            AND rider_id = $2

            AND status = 'PICKED_UP'

          RETURNING *
          `,
          [
            deliveryId,
            req.user.id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        const delivery =
          await getAuthorizedDelivery(
            deliveryId,
            req.user.id
          );


        if (!delivery) {

          return res.status(404).json({
            error:
              'Delivery not found.'
          });
        }


        return res.status(409).json({
          error:
            `Delivery cannot start from its current status: ${delivery.status}.`
        });
      }


      return res.json({

        success: true,

        message:
          'Delivery is now in transit.',

        delivery:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        'Transit status update error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to start delivery.'
      });
    }
  }
);


// ==================================================
// RIDER: UPDATE LIVE DELIVERY LOCATION
// ==================================================

app.post(
  '/api/rider/deliveries/:id/location',

  authorizeRoles('rider'),

  async (req, res) => {

    const deliveryId =
      Number.parseInt(
        req.params.id,
        10
      );

    const latitude =
      Number(req.body.latitude);

    const longitude =
      Number(req.body.longitude);


    if (
      !Number.isInteger(
        deliveryId
      )
    ) {

      return res.status(400).json({
        error:
          'Invalid delivery ID.'
      });
    }


    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||

      latitude < -90 ||
      latitude > 90 ||

      longitude < -180 ||
      longitude > 180
    ) {

      return res.status(400).json({
        error:
          'Valid latitude and longitude are required.'
      });
    }


    try {

      const delivery =
        await getAuthorizedDelivery(
          deliveryId,
          req.user.id
        );


      if (!delivery) {

        return res.status(404).json({
          error:
            'Delivery not found.'
        });
      }


      if (
        Number(delivery.rider_id) !==
        Number(req.user.id)
      ) {

        return res.status(403).json({
          error:
            'Only the assigned rider can update this delivery location.'
        });
      }


      if (
        ![
          'ASSIGNED',
          'PICKED_UP',
          'IN_TRANSIT'
        ].includes(
          delivery.status
        )
      ) {

        return res.status(409).json({
          error:
            `Location updates are not allowed while the delivery is ${delivery.status}.`
        });
      }


      const result =
        await pool.query(
          `
          INSERT INTO telemetries (
            delivery_id,
            latitude,
            longitude
          )

          VALUES (
            $1,
            $2,
            $3
          )

          RETURNING

            delivery_id
              AS "deliveryId",

            latitude,

            longitude,

            created_at
              AS "createdAt"
          `,
          [
            deliveryId,
            latitude,
            longitude
          ]
        );


      return res.status(201).json({

        success: true,

        location:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        'Delivery location update error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to update delivery location.'
      });
    }
  }
);
// ==================================================
// CUSTOMER OR ASSIGNED RIDER:
// VIEW DELIVERY TRACKING
// ==================================================

app.get(
  '/api/deliveries/:id/tracking',

  async (req, res) => {

    const deliveryId =
      Number.parseInt(
        req.params.id,
        10
      );


    if (
      !Number.isInteger(
        deliveryId
      )
    ) {

      return res.status(400).json({
        error:
          'Invalid delivery ID.'
      });
    }


    try {

      const delivery =
        await getAuthorizedDelivery(
          deliveryId,
          req.user.id
        );


      if (!delivery) {

        return res.status(404).json({
          error:
            'Delivery not found.'
        });
      }


      const locationsResult =
        await pool.query(
          `
          SELECT

            id,

            latitude,

            longitude,

            created_at
              AS "timestamp"

          FROM telemetries

          WHERE delivery_id = $1

          ORDER BY
            created_at DESC

          LIMIT 100
          `,
          [deliveryId]
        );


      return res.json({

        success: true,

        delivery,

        currentLocation:
          locationsResult.rows[0] ||
          null,

        locations:
          locationsResult.rows

      });

    } catch (error) {

      console.error(
        'FAGA delivery tracking error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to retrieve delivery tracking.'
      });
    }
  }
);


// ==================================================
// RIDER: COMPLETE DELIVERY
// ==================================================

app.post(
  '/api/rider/deliveries/:id/complete',

  authorizeRoles('rider'),

  async (req, res) => {

    const deliveryId =
      Number.parseInt(
        req.params.id,
        10
      );


    if (
      !Number.isInteger(
        deliveryId
      )
    ) {

      return res.status(400).json({
        error:
          'Invalid delivery ID.'
      });
    }


    try {

      const result =
        await pool.query(
          `
          UPDATE deliveries

          SET

            status = 'DELIVERED',

            delivered_at =
              CURRENT_TIMESTAMP,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE

            id = $1

            AND rider_id = $2

            AND status = 'IN_TRANSIT'

          RETURNING *
          `,
          [
            deliveryId,
            req.user.id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        const delivery =
          await getAuthorizedDelivery(
            deliveryId,
            req.user.id
          );


        if (!delivery) {

          return res.status(404).json({
            error:
              'Delivery not found.'
          });
        }


        return res.status(409).json({
          error:
            `Delivery cannot be completed from its current status: ${delivery.status}.`
        });
      }


      return res.json({

        success: true,

        message:
          'Delivery completed successfully.',

        delivery:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        'FAGA delivery completion error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to complete delivery.'
      });
    }
  }
);


// ==================================================
// CUSTOMER: CANCEL DELIVERY
// ==================================================

app.post(
  '/api/deliveries/:id/cancel',

  async (req, res) => {

    const deliveryId =
      Number.parseInt(
        req.params.id,
        10
      );


    if (
      !Number.isInteger(
        deliveryId
      )
    ) {

      return res.status(400).json({
        error:
          'Invalid delivery ID.'
      });
    }


    const client =
      await pool.connect();


    try {

      await client.query(
        'BEGIN'
      );


      /*
       * Lock the delivery row so a rider
       * cannot accept/update it at the
       * same time the customer cancels it.
       */

      const deliveryResult =
        await client.query(
          `
          SELECT

            id,

            customer_id,

            rider_id,

            status

          FROM deliveries

          WHERE id = $1

          FOR UPDATE
          `,
          [deliveryId]
        );


      if (
        deliveryResult.rows.length === 0
      ) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(404).json({
          error:
            'Delivery not found.'
        });
      }


      const delivery =
        deliveryResult.rows[0];


      if (
        Number(delivery.customer_id) !==
        Number(req.user.id)
      ) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(403).json({
          error:
            'You are not authorized to cancel this delivery.'
        });
      }


      /*
       * A customer can only cancel
       * before the package has been picked up.
       */

      if (
        ![
          'PENDING',
          'ASSIGNED'
        ].includes(
          delivery.status
        )
      ) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(409).json({
          error:
            `This delivery cannot be cancelled while it is ${delivery.status}.`
        });
      }


      const updateResult =
        await client.query(
          `
          UPDATE deliveries

          SET

            status = 'CANCELLED',

            cancelled_at =
              CURRENT_TIMESTAMP,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = $1

          RETURNING *
          `,
          [deliveryId]
        );


      /*
       * Expire all outstanding rider
       * offers for this delivery.
       */

      await client.query(
        `
        UPDATE delivery_matches

        SET

          status = 'EXPIRED',

          responded_at =
            CURRENT_TIMESTAMP

        WHERE

          delivery_id = $1

          AND status IN (
            'OFFERED',
            'ACCEPTED'
          )
        `,
        [deliveryId]
      );


      await client.query(
        'COMMIT'
      );


      return res.json({

        success: true,

        message:
          'Delivery cancelled successfully.',

        delivery:
          updateResult.rows[0]

      });

    } catch (error) {

      await client.query(
        'ROLLBACK'
      );

      console.error(
        'FAGA delivery cancellation error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to cancel delivery.'
      });

    } finally {

      client.release();

    }
  }
);


// ==================================================
// GLOBAL 404 HANDLER
// ==================================================
//
// Any API route that reaches this point
// was not registered above.
//
// This is useful because it gives the
// frontend a JSON response instead of
// an HTML Express error page.
//

app.use(
  '/api',
  (req, res) => {

    return res.status(404).json({

      success: false,

      message:
        `FAGA API endpoint not found: ${req.method} ${req.originalUrl}`

    });
  }
);


// ==================================================
// GLOBAL ERROR HANDLER
// ==================================================

app.use(
  (error, req, res, next) => {

    console.error(
      'FAGA unhandled server error:',
      error
    );


    if (
      res.headersSent
    ) {

      return next(error);
    }


    return res.status(
      error.status ||
      500
    ).json({

      success: false,

      message:
        process.env.NODE_ENV === 'production'
          ? 'An unexpected server error occurred.'
          : (
              error.message ||
              'An unexpected server error occurred.'
            )

    });
  }
);


// ==================================================
// START FAGA SERVER
// ==================================================

async function startServer() {

  try {

    await startDatabase();


    app.listen(
      PORT,
      () => {

        console.log(
          `FAGA Pure Node Engine streaming live on port ${PORT} 🚀`
        );

      }
    );

  } catch (error) {

    console.error(
      'FAGA server startup failed:',
      error
    );

    process.exit(1);
  }
}


startServer();
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized for this action.'
      });
    }

    next();
  };
}