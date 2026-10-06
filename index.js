require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'faga_production_secure_token_secret_key';

// ==========================================
// CORS CONFIGURATION
// ==========================================

// Allows the FAGA frontend to communicate with the Railway API.
app.use((req, res, next) => {
  const allowedOrigin = process.env.FRONTEND_URL || '*';

  res.header('Access-Control-Allow-Origin', allowedOrigin);
  res.header(
    'Access-Control-Allow-Methods',
    'GET,POST,PATCH,PUT,DELETE,OPTIONS'
  );
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );

  // Browser CORS preflight request
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Parse JSON request bodies
app.use(express.json());

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

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'online'
  });
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
    ADD COLUMN IF NOT EXISTS distance_km NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS duration_minutes INT,
    ADD COLUMN IF NOT EXISTS driver_eta_minutes INT;

  CREATE INDEX IF NOT EXISTS rides_customer_idx
    ON rides(customer_id);

  CREATE INDEX IF NOT EXISTS rides_driver_idx
    ON rides(driver_id);

  CREATE INDEX IF NOT EXISTS rides_status_idx
    ON rides(status);

  CREATE INDEX IF NOT EXISTS ride_locations_ride_idx
    ON ride_locations(ride_id, created_at DESC);
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
      type VARCHAR(50) NOT NULL, -- 'DEPOSIT', 'WITHDRAWAL', 'PAYMENT'
      status VARCHAR(50) DEFAULT 'COMPLETED', -- 'PENDING', 'COMPLETED', 'FAILED'
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

  console.log("FAGA Production Database tables initialized successfully. 🗄");
  } catch (err) {
    console.error(
      "Critical failure configuring database layout on boot:",
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
  const enabled = process.env.FAGA_SUPER_ADMIN_BOOTSTRAP === 'true';

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
      const hashedPassword = await bcrypt.hash(password, 12);

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

      console.log(`Super Admin account created: ${email}`);
    } else {
      user = existingUser.rows[0];

      if (user.role !== 'super_admin' || !user.is_active) {
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

        console.log(`Existing account elevated to Super Admin: ${email}`);
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

    console.log(`Super Admin bootstrap completed for ${email}`);
  } catch (error) {
    console.error('Super Admin bootstrap failed:', error.message);
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

    console.log('FAGA database startup sequence completed successfully.');
  } catch (error) {
    console.error('FAGA startup initialization failed:', error.message);
    process.exit(1);
  }
};

startDatabase();

// ==========================================
// AUTHENTICATION GUARD
// ==========================================

const authenticateToken = async (req, res, next) => {

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

  const authHeader = req.headers['authorization'];

  // Expected format:
  // Authorization: Bearer YOUR_TOKEN
  const token =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;

  if (!token) {
    return res.status(401).json({
      message: 'Unauthorized access: Session token missing.'
    });
  }

  try {

    const decoded = jwt.verify(token, JWT_SECRET);

    const userQuery = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        role,
        is_active
      FROM users
      WHERE id = $1
      `,
      [decoded.id]
    );

    if (userQuery.rows.length === 0) {
      return res.status(403).json({
        message: 'Access forbidden: Suspended or invalid user accounts.'
      });
    }

    const user = userQuery.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        message: 'Access forbidden: Suspended or invalid user accounts.'
      });
    }

    // Attach authenticated user to request
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.is_active
    };

    next();

  } catch (err) {

    console.error('Authentication error:', err.message);

    return res.status(403).json({
      message: 'Invalid or expired session parameters.'
    });
  }
};

// 🛡️ Role Enforcement Guard (Replaces Laravel's EnsureUserHasRole middleware)
const authorizeRoles = (...allowedRoles) => {
  const expandedRoles = new Set(allowedRoles);

  // Super Admin has access to every administrative endpoint
  if (allowedRoles.includes('admin')) {
    expandedRoles.add('super_admin');
  }

  return (req, res, next) => {
    if (!expandedRoles.has(req.user.role)) {
      return res.status(403).json({
        message: 'Access forbidden: Insufficient access privileges.'
      });
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

// ==========================================
// FAGA LIVE RIDE BOOKING & TRACKING
// ==========================================
// ==========================================
// FAGA REAL ROUTING ENGINE
// ==========================================

const FAGA_ROUTING_URL =
  process.env.FAGA_ROUTING_URL ||
  'https://router.project-osrm.org';

const FAGA_GEOCODING_URL =
  process.env.FAGA_GEOCODING_URL ||
  'https://nominatim.openstreetmap.org/search';

async function geocodeFagaAddress(address) {
  const cleanAddress = String(address || '').trim();

  if (!cleanAddress) {
    throw new Error('Address is required for geocoding.');
  }

  try {
    const response = await axios.get(
      FAGA_GEOCODING_URL,
      {
        params: {
          q: cleanAddress,
          format: 'json',
          limit: 1,
          addressdetails: 1,
          countrycodes:
            process.env.FAGA_GEOCODING_COUNTRY_CODES || 'ng'
        },
        headers: {
          'User-Agent':
            process.env.FAGA_GEOCODING_USER_AGENT ||
            'FAGA Logistics Platform'
        },
        timeout: 10000
      }
    );

    const result = response.data?.[0];

    if (!result) {
      throw new Error(
        `Unable to locate address: ${cleanAddress}`
      );
    }

    const latitude = Number(result.lat);
    const longitude = Number(result.lon);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      throw new Error(
        `Invalid coordinates returned for: ${cleanAddress}`
      );
    }

    return {
      latitude,
      longitude,
      displayName: result.display_name || cleanAddress
    };

  } catch (error) {

    console.error(
      'FAGA geocoding error:',
      error.response?.data || error.message
    );

    throw new Error(
      `Unable to locate "${cleanAddress}". Please provide a more specific address.`
    );
  }
}


async function getFagaRoadRoute(
  pickupLatitude,
  pickupLongitude,
  destinationLatitude,
  destinationLongitude
) {

  const coordinates =
    `${pickupLongitude},${pickupLatitude};` +
    `${destinationLongitude},${destinationLatitude}`;

  try {

    const response = await axios.get(
      `${FAGA_ROUTING_URL}/route/v1/driving/${coordinates}`,
      {
        params: {
          overview: 'full',
          geometries: 'geojson',
          steps: false
        },
        timeout: 15000
      }
    );

    const route =
      response.data?.routes?.[0];

    if (
      response.data?.code !== 'Ok' ||
      !route
    ) {
      throw new Error(
        'No driving route was returned.'
      );
    }

    const distanceKm =
      Number(route.distance) / 1000;

    const durationMinutes =
      Math.max(
        1,
        Math.ceil(
          Number(route.duration) / 60
        )
      );

    if (
      !Number.isFinite(distanceKm) ||
      !Number.isFinite(durationMinutes)
    ) {
      throw new Error(
        'Invalid route information returned.'
      );
    }

    return {
      distanceKm: Number(
        distanceKm.toFixed(2)
      ),

      durationMinutes,

      geometry:
        route.geometry?.coordinates || []
    };

  } catch (error) {

    console.error(
      'FAGA routing error:',
      error.response?.data || error.message
    );

    throw new Error(
      'Unable to calculate the road route right now. Please try again.'
    );
  }
}


async function resolveFagaCoordinates({
  address,
  latitude,
  longitude
}) {

  const validLatitude =
    Number.isFinite(Number(latitude));

  const validLongitude =
    Number.isFinite(Number(longitude));

  if (
    validLatitude &&
    validLongitude
  ) {

    return {
      latitude: Number(latitude),
      longitude: Number(longitude),
      displayName: address
    };
  }

  return geocodeFagaAddress(address);
}


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
      address: pickupAddress,
      latitude: pickupLatitude,
      longitude: pickupLongitude
    });

  const destination =
    await resolveFagaCoordinates({
      address: destinationAddress,
      latitude: destinationLatitude,
      longitude: destinationLongitude
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
      route.durationMinutes * 60 * 1000
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

app.post('/api/rides/estimate', async (req, res) => {

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

  if (
    !pickupAddress ||
    !destinationAddress
  ) {
    return res.status(422).json({
      message:
        'Pickup and destination are required.'
    });
  }

  const allowedRideTypes = {
    economy: 1800,
    comfort: 2500,
    xl: 3500
  };

  const normalizedRideType =
    String(rideType).toLowerCase();

  const passengerCount =
    Number(passengers);

  if (
    !allowedRideTypes[normalizedRideType]
  ) {
    return res.status(422).json({
      message:
        'Invalid ride type.'
    });
  }

  if (
    !Number.isInteger(passengerCount) ||
    passengerCount < 1 ||
    passengerCount > 6
  ) {
    return res.status(422).json({
      message:
        'Passengers must be between 1 and 6.'
    });
  }

  try {

    const route =
      await buildFagaRoute({
        pickupAddress,
        destinationAddress,
        pickupLatitude,
        pickupLongitude,
        destinationLatitude,
        destinationLongitude
      });

    const fare =
      allowedRideTypes[normalizedRideType] +
      Math.max(
        0,
        passengerCount - 1
      ) * 150;

    return res.json({
      success: true,

      estimate: {
        pickup: route.pickup,
        destination: route.destination,

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
      message:
        error.message ||
        'Unable to calculate ride estimate.'
    });
  }
});

// --------------------------------------------------
// ROUTE CALCULATOR
// Uses the real road network through OSRM.
// Distance = actual driving route distance.
// Duration = actual routing duration.
// --------------------------------------------------

async function calculateRideRoute(
  pickupLatitude,
  pickupLongitude,
  destinationLatitude,
  destinationLongitude
) {
  const coordinates = [
    `${pickupLongitude},${pickupLatitude}`,
    `${destinationLongitude},${destinationLatitude}`
  ].join(';');

  const url =
    `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
    `?overview=false&alternatives=false&steps=false`;

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 10000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FAGA-Backend/1.0'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Routing service returned HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (
      data.code !== 'Ok' ||
      !Array.isArray(data.routes) ||
      !data.routes[0]
    ) {
      throw new Error(
        data.message || 'No driving route was found.'
      );
    }

    const route = data.routes[0];

    const distanceKm = Number(
      (Number(route.distance) / 1000).toFixed(2)
    );

    const durationMinutes = Math.max(
      1,
      Math.ceil(Number(route.duration) / 60)
    );

    return {
      distanceKm,
      durationMinutes
    };

  } finally {
    clearTimeout(timeout);
  }
}


// --------------------------------------------------
// POST /api/rides
// Create a real customer ride request.
// --------------------------------------------------

// ==========================================
// FAGA LIVE RIDE ROUTING
// ==========================================

async function calculateRideRoute({
  pickupLatitude,
  pickupLongitude,
  destinationLatitude,
  destinationLongitude
}) {
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

  const startLat = Number(pickupLatitude);
  const startLng = Number(pickupLongitude);
  const endLat = Number(destinationLatitude);
  const endLng = Number(destinationLongitude);

  if (
    !Number.isFinite(startLat) ||
    !Number.isFinite(startLng) ||
    !Number.isFinite(endLat) ||
    !Number.isFinite(endLng)
  ) {
    return null;
  }

  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${startLng},${startLat};${endLng},${endLat}` +
    `?overview=false&steps=false`;

  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'FAGA-Ride-Engine/1.0'
    }
  });

  if (
    !response.data ||
    response.data.code !== 'Ok' ||
    !Array.isArray(response.data.routes) ||
    !response.data.routes.length
  ) {
    return null;
  }

  const route = response.data.routes[0];

  const distanceKm = Number(route.distance) / 1000;

  const durationMinutes = Math.max(
    1,
    Math.ceil(Number(route.duration) / 60)
  );

  return {
    distanceKm: Number(distanceKm.toFixed(2)),
    durationMinutes,
    driverEtaMinutes: null
  };
}


// ==========================================
// LIVE RIDE BOOKING
// ==========================================

app.post('/api/rides', async (req, res) => {
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

  const allowedRideTypes = {
    economy: 1800,
    comfort: 2500,
    xl: 3500
  };

  const normalizedRideType = String(rideType).trim().toLowerCase();
  const passengerCount = Number(passengers);

  if (!pickupAddress || !destinationAddress) {
    return res.status(422).json({
      message: 'Pickup and destination are required.'
    });
  }

  if (!Object.prototype.hasOwnProperty.call(
    allowedRideTypes,
    normalizedRideType
  )) {
    return res.status(422).json({
      message: 'Invalid ride type.'
    });
  }

  if (
    !Number.isInteger(passengerCount) ||
    passengerCount < 1 ||
    passengerCount > 6
  ) {
    return res.status(422).json({
      message: 'Passengers must be between 1 and 6.'
    });
  }

  try {
    // ------------------------------------------
    // REAL ROUTE CALCULATION
    // ------------------------------------------

    let route = null;

    if (
      pickupLatitude !== null &&
      pickupLongitude !== null &&
      destinationLatitude !== null &&
      destinationLongitude !== null
    ) {
      route = await calculateRideRoute({
        pickupLatitude,
        pickupLongitude,
        destinationLatitude,
        destinationLongitude
      });
    }

    /*
     * If the browser did not provide coordinates,
     * we cannot honestly calculate distance or trip time.
     *
     * We therefore return null rather than displaying
     * fake/demo values.
     */

    const distanceKm = route?.distanceKm ?? null;
    const durationMinutes = route?.durationMinutes ?? null;

    /*
     * Driver ETA is different from trip duration.
     *
     * There is no assigned driver at the moment of booking,
     * so driver ETA must remain null until a real driver
     * accepts the ride and sends a live location.
     */
    const driverEtaMinutes = null;

    // ------------------------------------------
    // SERVER-SIDE FARE
    // ------------------------------------------

    const baseFare = allowedRideTypes[normalizedRideType];

    const passengerCharge =
      Math.max(0, passengerCount - 1) * 150;

    /*
     * Distance-based fare when a real route exists.
     *
     * Base fare:
     * economy = ₦1,800
     * comfort = ₦2,500
     * XL      = ₦3,500
     *
     * Additional distance:
     * ₦250 per kilometre
     */
    const distanceCharge =
      Number.isFinite(distanceKm)
        ? distanceKm * 250
        : 0;

    const rawFare =
      baseFare +
      distanceCharge +
      passengerCharge;

    const fare =
      Math.max(
        baseFare,
        Math.round(rawFare / 50) * 50
      );

    // ------------------------------------------
    // SAVE RIDE
    // ------------------------------------------

    const result = await pool.query(
      `
      INSERT INTO rides (
        customer_id,
        status,
        pickup_address,
        destination_address,
        pickup_latitude,
        pickup_longitude,
        destination_latitude,
        destination_longitude,
        ride_type,
        passengers,
        fare,
        distance_km,
        duration_minutes,
        driver_eta_minutes
      )
      VALUES (
        $1,
        'SEARCHING',
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
        $13
      )
      RETURNING
        id,
        customer_id AS "customerId",
        driver_id AS "driverId",
        status,
        pickup_address AS "pickupAddress",
        destination_address AS "destinationAddress",
        pickup_latitude AS "pickupLatitude",
        pickup_longitude AS "pickupLongitude",
        destination_latitude AS "destinationLatitude",
        destination_longitude AS "destinationLongitude",
        ride_type AS "rideType",
        passengers,
        fare,
        distance_km AS "distanceKm",
        duration_minutes AS "durationMinutes",
        driver_eta_minutes AS "driverEtaMinutes",estimated_arrival_at AS "estimatedArrivalAt",
        route_geometry AS "routeGeometry",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [
        req.user.id,
        String(pickupAddress).trim(),
        String(destinationAddress).trim(),
        pickupLatitude,
        pickupLongitude,
        destinationLatitude,
        destinationLongitude,
        normalizedRideType,
        passengerCount,
        fare,
        distanceKm,
        durationMinutes,
        driverEtaMinutes
      ]
    );

    const ride = result.rows[0];

    return res.status(201).json({
      success: true,
      message: 'Ride request created successfully.',
      ride: {
        ...ride,
        distanceKm:
          ride.distanceKm !== null
            ? Number(ride.distanceKm)
            : null,
        durationMinutes:
          ride.durationMinutes !== null
            ? Number(ride.durationMinutes)
            : null,
        driverEtaMinutes:
          ride.driverEtaMinutes !== null
            ? Number(ride.driverEtaMinutes)
            : null,
        fare: Number(ride.fare)
      }
    });

  } catch (error) {
    console.error('FAGA ride creation error:', error);

    return res.status(500).json({
      message: 'Unable to calculate or create the ride right now.',
      error:
        process.env.NODE_ENV === 'production'
          ? undefined
          : error.message
    });
  }
});


// --------------------------------------------------
// GET ONE RIDE
// --------------------------------------------------

app.get('/api/rides/:id', async (req, res) => {

  const rideId =
    Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(rideId)) {
    return res.status(422).json({
      message: 'Invalid ride ID.'
    });
  }

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

      WHERE id = $1
        AND customer_id = $2
      `,

      [
        rideId,
        req.user.id
      ]
    );

    if (result.rows.length === 0) {

      return res.status(404).json({
        message: 'Ride not found.'
      });
    }

    return res.json({
      success: true,
      ride: result.rows[0]
    });

  } catch (error) {

    console.error(
      'FAGA ride lookup error:',
      error
    );

    return res.status(500).json({
      message:
        'Unable to load the ride.'
    });
  }
});


// --------------------------------------------------
// LIVE RIDE TRACKING
// --------------------------------------------------

app.get('/api/rides/:id/tracking', async (req, res) => {

  const rideId =
    Number.parseInt(
      req.params.id,
      10
    );

  if (!Number.isInteger(rideId)) {
    return res.status(422).json({
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

          estimated_arrival_at AS "estimatedArrivalAt",

          route_geometry AS "routeGeometry"

        FROM rides

        WHERE id = $1
          AND customer_id = $2
        `,
        [
          rideId,
          req.user.id
        ]
      );

    if (
      rideResult.rows.length === 0
    ) {
      return res.status(404).json({
        message:
          'Ride not found.'
      });
    }

    const ride =
      rideResult.rows[0];

    const locationResult =
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

    let driverLocation =
      locationResult.rows[0] || null;

    let calculatedDriverEta =
      null;

    /*
     * If the driver app has supplied
     * a real GPS position, calculate
     * the actual road ETA to pickup.
     */
    if (
      driverLocation &&
      ride.pickupLatitude != null &&
      ride.pickupLongitude != null
    ) {

      try {

        const driverRoute =
          await getFagaRoadRoute(

            Number(
              driverLocation.latitude
            ),

            Number(
              driverLocation.longitude
            ),

            Number(
              ride.pickupLatitude
            ),

            Number(
              ride.pickupLongitude
            )

          );

        calculatedDriverEta =
          driverRoute.durationMinutes;

        await pool.query(
          `
          UPDATE rides

          SET
            driver_eta_minutes = $1,
            updated_at = CURRENT_TIMESTAMP

          WHERE id = $2
          `,
          [
            calculatedDriverEta,
            rideId
          ]
        );

        ride.driverEtaMinutes =
          calculatedDriverEta;

      } catch (etaError) {

        console.warn(
          'Driver ETA calculation unavailable:',
          etaError.message
        );

      }
    }

    return res.json({

      success: true,

      ride,

      driverLocation,

      driverEtaMinutes:
        calculatedDriverEta ??
        ride.driverEtaMinutes ??
        null

    });

  } catch (error) {

    console.error(
      'FAGA ride tracking error:',
      error
    );

    return res.status(500).json({
      message:
        'Unable to load ride tracking.'
    });
  }
});


// --------------------------------------------------
// CUSTOMER CANCEL RIDE
// --------------------------------------------------

app.post(
  '/api/rides/:id/cancel',
  async (req, res) => {

    const rideId =
      Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(rideId)) {

      return res.status(422).json({
        message: 'Invalid ride ID.'
      });
    }

    try {

      const result =
        await pool.query(
          `
          UPDATE rides

          SET
            status = 'CANCELLED',

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = $1

            AND customer_id = $2

            AND status NOT IN (
              'COMPLETED',
              'CANCELLED'
            )

          RETURNING

            id,

            status,

            distance_km AS "distanceKm",

            duration_minutes AS "durationMinutes",

            driver_eta_minutes AS "driverEtaMinutes"
          `,

          [
            rideId,
            req.user.id
          ]
        );

      if (result.rows.length === 0) {

        return res.status(409).json({
          message:
            'This ride cannot be cancelled.'
        });
      }

      return res.json({

        success: true,

        message:
          'Ride cancelled successfully.',

        ride:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        'FAGA ride cancellation error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to cancel the ride.'
      });
    }
  }
);

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
// ==========================================
// FAGA DISPATCH DELIVERY ENGINE
// ==========================================

// Create a delivery request and search for available riders
app.post('/api/deliveries', async (req, res) => {
  const {
    pickup,
    destination,
    package: packageInfo,
    recipient
  } = req.body;

  // ------------------------------
  // Validate pickup
  // ------------------------------
  if (
    !pickup ||
    !pickup.address ||
    typeof pickup.latitude !== 'number' ||
    typeof pickup.longitude !== 'number'
  ) {
    return res.status(400).json({
      error: 'Valid pickup address and coordinates are required.'
    });
  }

  // ------------------------------
  // Validate destination
  // ------------------------------
  if (
    !destination ||
    !destination.address ||
    typeof destination.latitude !== 'number' ||
    typeof destination.longitude !== 'number'
  ) {
    return res.status(400).json({
      error: 'Valid destination address and coordinates are required.'
    });
  }

  // ------------------------------
  // Validate recipient
  // ------------------------------
  if (
    !recipient ||
    !recipient.name ||
    !recipient.phone
  ) {
    return res.status(400).json({
      error: 'Recipient name and phone number are required.'
    });
  }

  // ------------------------------
  // Package information
  // ------------------------------
  const packageDescription =
    packageInfo?.description || 'General package';

  const packageType =
    packageInfo?.type || 'general';

  const packageWeight =
    Number(packageInfo?.weight) || 1;

  if (packageWeight <= 0) {
    return res.status(400).json({
      error: 'Package weight must be greater than zero.'
    });
  }

  // ------------------------------
  // Coordinate validation
  // ------------------------------
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
      error: 'Invalid geographic coordinates.'
    });
  }

  // ------------------------------
  // Distance calculation
  // Haversine formula
  // ------------------------------
  const toRadians = (value) => value * Math.PI / 180;

  const earthRadiusKm = 6371;

  const latitudeDifference =
    toRadians(destination.latitude - pickup.latitude);

  const longitudeDifference =
    toRadians(destination.longitude - pickup.longitude);

  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(toRadians(pickup.latitude)) *
    Math.cos(toRadians(destination.latitude)) *
    Math.sin(longitudeDifference / 2) ** 2;

  const distanceKm =
    earthRadiusKm *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // ------------------------------
  // Server-side delivery pricing
  // ------------------------------
  const baseFare = 1500;
  const perKm = 250;

  const calculatedFee =
    baseFare + (distanceKm * perKm);

  const deliveryFee =
    Math.round(calculatedFee / 50) * 50;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ------------------------------
    // Create delivery
    // ------------------------------
    const deliveryResult = await client.query(
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
        $1, 'PENDING',
        $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10,
        $11, $12,
        $13, $14,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING
        id,
        customer_id AS "customerId",
        status,
        pickup_address AS "pickupAddress",
        pickup_latitude AS "pickupLatitude",
        pickup_longitude AS "pickupLongitude",
        dropoff_address AS "dropoffAddress",
        dropoff_latitude AS "dropoffLatitude",
        dropoff_longitude AS "dropoffLongitude",
        package_description AS "packageDescription",
        package_type AS "packageType",
        package_weight AS "packageWeight",
        recipient_name AS "recipientName",
        recipient_phone AS "recipientPhone",
        distance_km AS "distanceKm",
        delivery_fee AS "deliveryFee",
        requested_at AS "requestedAt"
      `,
      [
        req.user.id,
        pickup.address,
        pickup.latitude,
        pickup.longitude,
        destination.address,
        destination.latitude,
        destination.longitude,
        packageDescription,
        packageType,
        packageWeight,
        recipient.name,
        recipient.phone,
        Number(distanceKm.toFixed(2)),
        deliveryFee
      ]
    );

    const delivery = deliveryResult.rows[0];

    // ------------------------------
    // Find available riders
    // ------------------------------
    const ridersResult = await client.query(
      `
      SELECT id, name, email
      FROM users
      WHERE role = 'rider'
        AND is_active = true
        AND id <> $1
      ORDER BY id ASC
      LIMIT 10
      `,
      [req.user.id]
    );

    // ------------------------------
    // Create rider offers
    // ------------------------------
    for (const rider of ridersResult.rows) {
      await client.query(
        `
        INSERT INTO delivery_matches (
          delivery_id,
          rider_id,
          status
        )
        VALUES ($1, $2, 'OFFERED')
        ON CONFLICT (delivery_id, rider_id)
        DO NOTHING
        `,
        [delivery.id, rider.id]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: ridersResult.rows.length > 0
        ? 'Delivery request created. Searching for a dispatch rider.'
        : 'Delivery request created. No available rider was found yet.',
      delivery,
      ridersContacted: ridersResult.rows.length
    });

  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Delivery creation error:', error);

    res.status(500).json({
      error: 'Unable to create delivery request.',
      details: error.message
    });

  } finally {
    client.release();
  }
});


// ==========================================
// GET MY DELIVERIES
// ==========================================

app.get('/api/deliveries', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        customer_id AS "customerId",
        rider_id AS "riderId",
        status,
        pickup_address AS "pickupAddress",
        pickup_latitude AS "pickupLatitude",
        pickup_longitude AS "pickupLongitude",
        dropoff_address AS "dropoffAddress",
        dropoff_latitude AS "dropoffLatitude",
        dropoff_longitude AS "dropoffLongitude",
        package_description AS "packageDescription",
        package_type AS "packageType",
        package_weight AS "packageWeight",
        recipient_name AS "recipientName",
        recipient_phone AS "recipientPhone",
        distance_km AS "distanceKm",
        delivery_fee AS "deliveryFee",
        requested_at AS "requestedAt",
        accepted_at AS "acceptedAt",
        picked_up_at AS "pickedUpAt",
        delivered_at AS "deliveredAt",
        cancelled_at AS "cancelledAt"
      FROM deliveries
      WHERE customer_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Delivery history error:', error);

    res.status(500).json({
      error: 'Unable to retrieve deliveries.'
    });
  }
});


// ==========================================
// GET ONE DELIVERY
// ==========================================

app.get('/api/deliveries/:id', async (req, res) => {
  const deliveryId = parseInt(req.params.id, 10);

  if (!Number.isInteger(deliveryId)) {
    return res.status(400).json({
      error: 'Invalid delivery ID.'
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        d.*,
        u.name AS "riderName",
        u.email AS "riderEmail"
      FROM deliveries d
      LEFT JOIN users u ON u.id = d.rider_id
      WHERE d.id = $1
        AND (
          d.customer_id = $2
          OR d.rider_id = $2
        )
      `,
      [deliveryId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Delivery not found.'
      });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Delivery lookup error:', error);

    res.status(500).json({
      error: 'Unable to retrieve delivery.'
    });
  }
});


// ==========================================
// RIDER: VIEW DELIVERY OFFERS
// ==========================================

app.get(
  '/api/rider/delivery-offers',
  authorizeRoles('rider'),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          dm.id AS "matchId",
          dm.delivery_id AS "deliveryId",
          dm.status AS "matchStatus",
          dm.offered_at AS "offeredAt",

          d.pickup_address AS "pickupAddress",
          d.dropoff_address AS "dropoffAddress",
          d.pickup_latitude AS "pickupLatitude",
          d.pickup_longitude AS "pickupLongitude",
          d.dropoff_latitude AS "dropoffLatitude",
          d.dropoff_longitude AS "dropoffLongitude",
          d.package_description AS "packageDescription",
          d.package_type AS "packageType",
          d.package_weight AS "packageWeight",
          d.distance_km AS "distanceKm",
          d.delivery_fee AS "deliveryFee",

          u.name AS "customerName"

        FROM delivery_matches dm

        INNER JOIN deliveries d
          ON d.id = dm.delivery_id

        INNER JOIN users u
          ON u.id = d.customer_id

        WHERE dm.rider_id = $1
          AND dm.status = 'OFFERED'
          AND d.status = 'PENDING'

        ORDER BY dm.offered_at DESC
        `,
        [req.user.id]
      );

      res.json(result.rows);

    } catch (error) {
      console.error('Rider delivery offers error:', error);

      res.status(500).json({
        error: 'Unable to retrieve delivery offers.'
      });
    }
  }
);


// ==========================================
// RIDER: ACCEPT DELIVERY
// ==========================================

app.post(
  '/api/rider/deliveries/:id/accept',
  authorizeRoles('rider'),
  async (req, res) => {

    const deliveryId = parseInt(req.params.id, 10);

    if (!Number.isInteger(deliveryId)) {
      return res.status(400).json({
        error: 'Invalid delivery ID.'
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Lock delivery so two riders cannot accept simultaneously
      const deliveryResult = await client.query(
        `
        SELECT id, status
        FROM deliveries
        WHERE id = $1
        FOR UPDATE
        `,
        [deliveryId]
      );

      if (deliveryResult.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Delivery not found.'
        });
      }

      const delivery = deliveryResult.rows[0];

      if (delivery.status !== 'PENDING') {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error: 'This delivery is no longer available.'
        });
      }

      // Confirm this rider actually received an offer
      const matchResult = await client.query(
        `
        SELECT id
        FROM delivery_matches
        WHERE delivery_id = $1
          AND rider_id = $2
          AND status = 'OFFERED'
        FOR UPDATE
        `,
        [deliveryId, req.user.id]
      );

      if (matchResult.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(403).json({
          error: 'This delivery offer is not available to you.'
        });
      }

      // Assign rider
      const updateResult = await client.query(
        `
        UPDATE deliveries
        SET
          rider_id = $1,
          status = 'ASSIGNED',
          accepted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
        `,
        [req.user.id, deliveryId]
      );

      // Mark this rider as accepted
      await client.query(
        `
        UPDATE delivery_matches
        SET
          status = 'ACCEPTED',
          responded_at = CURRENT_TIMESTAMP
        WHERE delivery_id = $1
          AND rider_id = $2
        `,
        [deliveryId, req.user.id]
      );

      // Cancel outstanding offers to other riders
      await client.query(
        `
        UPDATE delivery_matches
        SET
          status = 'EXPIRED',
          responded_at = CURRENT_TIMESTAMP
        WHERE delivery_id = $1
          AND rider_id <> $2
          AND status = 'OFFERED'
        `,
        [deliveryId, req.user.id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Delivery accepted successfully.',
        delivery: updateResult.rows[0]
      });

    } catch (error) {
      await client.query('ROLLBACK');

      console.error('Delivery acceptance error:', error);

      res.status(500).json({
        error: 'Unable to accept delivery.'
      });

    } finally {
      client.release();
    }
  }
);


// ==========================================
// RIDER: DECLINE DELIVERY
// ==========================================

app.post(
  '/api/rider/deliveries/:id/decline',
  authorizeRoles('rider'),
  async (req, res) => {

    const deliveryId = parseInt(req.params.id, 10);

    if (!Number.isInteger(deliveryId)) {
      return res.status(400).json({
        error: 'Invalid delivery ID.'
      });
    }

    try {
      const result = await pool.query(
        `
        UPDATE delivery_matches
        SET
          status = 'DECLINED',
          responded_at = CURRENT_TIMESTAMP
        WHERE delivery_id = $1
          AND rider_id = $2
          AND status = 'OFFERED'
        RETURNING id, delivery_id AS "deliveryId", status
        `,
        [deliveryId, req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Active delivery offer not found.'
        });
      }

      res.json({
        success: true,
        message: 'Delivery offer declined.',
        match: result.rows[0]
      });

    } catch (error) {
      console.error('Delivery decline error:', error);

      res.status(500).json({
        error: 'Unable to decline delivery.'
      });
    }
  }
);



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

// 2. Initialize Paystack Wallet Funding
app.post('/api/finance/deposit', async (req, res) => {
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount < 100) {
    return res.status(400).json({
      error: 'Minimum wallet funding amount is ₦100.'
    });
  }

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(500).json({
      error: 'Payment provider is not configured.'
    });
  }

  const client = await pool.connect();

  try {
    // Get authenticated customer's account
    const userResult = await client.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Customer account not found.'
      });
    }

    const user = userResult.rows[0];

    // Get or create wallet
    let walletResult = await client.query(
      'SELECT id FROM wallets WHERE user_id = $1',
      [req.user.id]
    );

    if (walletResult.rows.length === 0) {
      walletResult = await client.query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1, 0.00) RETURNING id',
        [req.user.id]
      );
    }

    const walletId = walletResult.rows[0].id;

    // Paystack expects the amount in kobo
    const amountInKobo = Math.round(amount * 100);

    // Generate unique payment reference
    const reference =
      `FAGA-WALLET-${req.user.id}-${Date.now()}-${crypto.randomUUID()}`;

    // Create pending transaction
    const transactionResult = await client.query(
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
      VALUES ($1, $2, 'DEPOSIT', 'PENDING', $3, 'paystack', $4)
      RETURNING
        id,
        amount,
        type,
        status,
        description,
        payment_provider AS "paymentProvider",
        payment_reference AS "paymentReference",
        created_at AS "createdAt"
      `,
      [
        walletId,
        amount,
        'FAGA Wallet Funding via Paystack',
        reference
      ]
    );

    try {
      const paystackResponse = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
          email: user.email,
          amount: amountInKobo,
          reference,
          callback_url:
            process.env.PAYSTACK_CALLBACK_URL ||
            'https://faga-frontend-portal.vercel.app/user-portal/dashboard.html',
          metadata: {
            userId: req.user.id,
            walletId,
            transactionId: transactionResult.rows[0].id,
            amount
          }
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
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
        message: 'Payment initialized successfully.',
        authorizationUrl: paystackResponse.data.data.authorization_url,
        accessCode: paystackResponse.data.data.access_code,
        reference: paystackResponse.data.data.reference,
        transaction: transactionResult.rows[0]
      });

    } catch (paystackError) {
      await client.query(
        `
        UPDATE transactions
        SET status = 'FAILED'
        WHERE id = $1
        `,
        [transactionResult.rows[0].id]
      );

      console.error(
        'Paystack initialization error:',
        paystackError.response?.data || paystackError.message
      );

      return res.status(502).json({
        error:
          paystackError.response?.data?.message ||
          'Unable to initialize Paystack payment.'
      });
    }

  } catch (error) {
    console.error('Wallet funding initialization error:', error);

    return res.status(500).json({
      error: 'Unable to initialize wallet funding.'
    });
  } finally {
    client.release();
  }
});


// 3. Verify Paystack Wallet Funding
app.get('/api/finance/deposit/verify/:reference', async (req, res) => {
  const { reference } = req.params;

  if (!reference) {
    return res.status(400).json({
      error: 'Payment reference is required.'
    });
  }

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(500).json({
      error: 'Payment provider is not configured.'
    });
  }

  try {
    // Verify transaction directly with Paystack
    const paystackResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        },
        timeout: 15000
      }
    );

    const payment = paystackResponse.data?.data;

    if (!payment) {
      return res.status(502).json({
        error: 'Invalid response from payment provider.'
      });
    }

    // Find the FAGA pending transaction
    const transactionResult = await pool.query(
      `
      SELECT
        t.id,
        t.wallet_id AS "walletId",
        t.amount,
        t.status,
        t.payment_reference AS "paymentReference",
        w.user_id AS "userId"
      FROM transactions t
      INNER JOIN wallets w ON w.id = t.wallet_id
      WHERE t.payment_provider = 'paystack'
        AND t.payment_reference = $1
      `,
      [reference]
    );

    if (transactionResult.rows.length === 0) {
      return res.status(404).json({
        error: 'FAGA payment transaction not found.'
      });
    }

    const transaction = transactionResult.rows[0];

    // Never allow one customer to verify another customer's payment
    if (Number(transaction.userId) !== Number(req.user.id)) {
      return res.status(403).json({
        error: 'You are not authorized to verify this payment.'
      });
    }

    const expectedAmountInKobo = Math.round(
      Number(transaction.amount) * 100
    );

    // Verify amount and currency returned by Paystack
    if (
      payment.currency !== 'NGN' ||
      Number(payment.amount) !== expectedAmountInKobo
    ) {
      return res.status(400).json({
        error: 'Payment amount or currency does not match the FAGA transaction.'
      });
    }

    // Payment was not successful
    if (payment.status !== 'success') {
      await pool.query(
        `
        UPDATE transactions
        SET status = 'FAILED'
        WHERE id = $1
          AND status = 'PENDING'
        `,
        [transaction.id]
      );

      return res.status(400).json({
        error: 'Payment was not successful.',
        paymentStatus: payment.status
      });
    }

    // Atomically credit the wallet
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const lockedTransaction = await client.query(
        `
        SELECT id, wallet_id, amount, status
        FROM transactions
        WHERE id = $1
        FOR UPDATE
        `,
        [transaction.id]
      );

      const currentTransaction = lockedTransaction.rows[0];

      if (!currentTransaction) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'FAGA transaction no longer exists.'
        });
      }

      // Already credited — safe idempotent response
      if (currentTransaction.status === 'COMPLETED') {
        await client.query('COMMIT');

        return res.json({
          message: 'Payment already verified and wallet credited.',
          reference,
          status: 'COMPLETED',
          amount: Number(currentTransaction.amount)
        });
      }

      if (currentTransaction.status !== 'PENDING') {
        await client.query('ROLLBACK');

        return res.status(400).json({
          error: 'This payment transaction is no longer pending.',
          status: currentTransaction.status
        });
      }

      await client.query(
        `
        UPDATE wallets
        SET
          balance = balance + $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        `,
        [
          Number(currentTransaction.amount),
          currentTransaction.wallet_id
        ]
      );

      const completedTransaction = await client.query(
        `
        UPDATE transactions
        SET status = 'COMPLETED'
        WHERE id = $1
        RETURNING
          id,
          amount,
          type,
          status,
          description,
          payment_provider AS "paymentProvider",
          payment_reference AS "paymentReference",
          created_at AS "createdAt"
        `,
        [currentTransaction.id]
      );

      await client.query('COMMIT');

      return res.json({
        message: 'Payment verified and wallet funded successfully.',
        reference,
        status: 'COMPLETED',
        transaction: completedTransaction.rows[0]
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error(
      'Paystack verification error:',
      error.response?.data || error.message
    );

    return res.status(502).json({
      error:
        error.response?.data?.message ||
        'Unable to verify payment with Paystack.'
    });
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




// ==========================================
// DELIVERY LIFECYCLE & TRACKING
// ==========================================

// Shared delivery lookup for customer/rider authorization.
async function getAuthorizedDelivery(deliveryId, userId) {
  const result = await pool.query(
    `
    SELECT
      d.*,
      u.name AS "riderName",
      u.email AS "riderEmail"
    FROM deliveries d
    LEFT JOIN users u ON u.id = d.rider_id
    WHERE d.id = $1
      AND (d.customer_id = $2 OR d.rider_id = $2)
    `,
    [deliveryId, userId]
  );

  return result.rows[0] || null;
}


// ==========================================
// RIDER: MARK PACKAGE PICKED UP
// ==========================================

app.post(
  '/api/rider/deliveries/:id/pickup',
  authorizeRoles('rider'),
  async (req, res) => {
    const deliveryId = parseInt(req.params.id, 10);

    if (!Number.isInteger(deliveryId)) {
      return res.status(400).json({
        error: 'Invalid delivery ID.'
      });
    }

    try {
      const result = await pool.query(
        `
        UPDATE deliveries
        SET
          status = 'PICKED_UP',
          picked_up_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND rider_id = $2
          AND status = 'ASSIGNED'
        RETURNING *
        `,
        [deliveryId, req.user.id]
      );

      if (result.rows.length === 0) {
        const delivery = await getAuthorizedDelivery(
          deliveryId,
          req.user.id
        );

        if (!delivery) {
          return res.status(404).json({
            error: 'Delivery not found.'
          });
        }

        return res.status(409).json({
          error:
            `Delivery cannot be marked as picked up from its current status: ${delivery.status}.`
        });
      }

      return res.json({
        success: true,
        message: 'Package marked as picked up.',
        delivery: result.rows[0]
      });
    } catch (error) {
      console.error('Pickup update error:', error);

      return res.status(500).json({
        error: 'Unable to update pickup status.'
      });
    }
  }
);


// ==========================================
// RIDER: START DELIVERY / TRANSIT
// ==========================================

app.post(
  '/api/rider/deliveries/:id/start',
  authorizeRoles('rider'),
  async (req, res) => {
    const deliveryId = parseInt(req.params.id, 10);

    if (!Number.isInteger(deliveryId)) {
      return res.status(400).json({
        error: 'Invalid delivery ID.'
      });
    }

    try {
      const result = await pool.query(
        `
        UPDATE deliveries
        SET
          status = 'IN_TRANSIT',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND rider_id = $2
          AND status = 'PICKED_UP'
        RETURNING *
        `,
        [deliveryId, req.user.id]
      );

      if (result.rows.length === 0) {
        const delivery = await getAuthorizedDelivery(
          deliveryId,
          req.user.id
        );

        if (!delivery) {
          return res.status(404).json({
            error: 'Delivery not found.'
          });
        }

        return res.status(409).json({
          error:
            `Delivery cannot start from its current status: ${delivery.status}.`
        });
      }

      return res.json({
        success: true,
        message: 'Delivery is now in transit.',
        delivery: result.rows[0]
      });
    } catch (error) {
      console.error('Transit status update error:', error);

      return res.status(500).json({
        error: 'Unable to start delivery.'
      });
    }
  }
);


// ==========================================
// RIDER: UPDATE LIVE DELIVERY LOCATION
// ==========================================

app.post(
  '/api/rider/deliveries/:id/location',
  authorizeRoles('rider'),
  async (req, res) => {
    const deliveryId = parseInt(req.params.id, 10);

    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);

    if (!Number.isInteger(deliveryId)) {
      return res.status(400).json({
        error: 'Invalid delivery ID.'
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
        error: 'Valid latitude and longitude are required.'
      });
    }

    try {
      const delivery = await getAuthorizedDelivery(
        deliveryId,
        req.user.id
      );

      if (!delivery) {
        return res.status(404).json({
          error: 'Delivery not found.'
        });
      }

      if (delivery.rider_id !== req.user.id) {
        return res.status(403).json({
          error:
            'Only the assigned rider can update this delivery location.'
        });
      }

      if (
        !['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'].includes(
          delivery.status
        )
      ) {
        return res.status(409).json({
          error:
            `Location updates are not allowed while the delivery is ${delivery.status}.`
        });
      }

      const result = await pool.query(
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
  delivery_id AS "deliveryId",
  latitude,
  longitude,
  created_at AS timestamp
        `,
        [deliveryId, latitude, longitude]
      );

      return res.status(201).json({
        success: true,
        location: result.rows[0]
      });
    } catch (error) {
      console.error(
        'Delivery location update error:',
        error
      );

      return res.status(500).json({
        error: 'Unable to update delivery location.'
      });
    }
  }
);


// ==========================================
// CUSTOMER OR ASSIGNED RIDER:
// VIEW DELIVERY TRACKING
// ==========================================

app.get(
  '/api/deliveries/:id/tracking',
  async (req, res) => {
    const deliveryId = parseInt(req.params.id, 10);

    if (!Number.isInteger(deliveryId)) {
      return res.status(400).json({
        error: 'Invalid delivery ID.'
      });
    }

    try {
      const delivery = await getAuthorizedDelivery(
        deliveryId,
        req.user.id
      );

      if (!delivery) {
        return res.status(404).json({
          error: 'Delivery not found.'
        });
      }

      const locationsResult = await pool.query(
        `
        SELECT
  id,
  latitude,
  longitude,
  created_at AS timestamp
FROM telemetries
WHERE delivery_id = $1
ORDER BY created_at DESC
LIMIT 100
        `,
        [deliveryId]
      );

      return res.json({
        success: true,
        delivery,
        currentLocation:
          locationsResult.rows[0] || null,
        locations: locationsResult.rows
      });
    } catch (error) {
      console.error(
        'Delivery tracking error:',
        error
      );

      return res.status(500).json({
        error: 'Unable to retrieve delivery tracking.'
      });
    }
  }
);


// ==========================================
// RIDER: COMPLETE DELIVERY
// ==========================================

app.post(
  '/api/rider/deliveries/:id/complete',
  authorizeRoles('rider'),
  async (req, res) => {
    const deliveryId = parseInt(req.params.id, 10);

    if (!Number.isInteger(deliveryId)) {
      return res.status(400).json({
        error: 'Invalid delivery ID.'
      });
    }

    try {
      const result = await pool.query(
        `
        UPDATE deliveries
        SET
          status = 'DELIVERED',
          delivered_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND rider_id = $2
          AND status = 'IN_TRANSIT'
        RETURNING *
        `,
        [deliveryId, req.user.id]
      );

      if (result.rows.length === 0) {
        const delivery = await getAuthorizedDelivery(
          deliveryId,
          req.user.id
        );

        if (!delivery) {
          return res.status(404).json({
            error: 'Delivery not found.'
          });
        }

        return res.status(409).json({
          error:
            `Delivery cannot be completed from its current status: ${delivery.status}.`
        });
      }

      return res.json({
        success: true,
        message: 'Delivery completed successfully.',
        delivery: result.rows[0]
      });
    } catch (error) {
      console.error(
        'Delivery completion error:',
        error
      );

      return res.status(500).json({
        error: 'Unable to complete delivery.'
      });
    }
  }
);


// ==========================================
// CUSTOMER: CANCEL DELIVERY BEFORE PICKUP
// ==========================================

app.post(
  '/api/deliveries/:id/cancel',
  async (req, res) => {
    const deliveryId = parseInt(req.params.id, 10);

    if (!Number.isInteger(deliveryId)) {
      return res.status(400).json({
        error: 'Invalid delivery ID.'
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const deliveryResult = await client.query(
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

      if (deliveryResult.rows.length === 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Delivery not found.'
        });
      }

      const delivery = deliveryResult.rows[0];

      if (delivery.customer_id !== req.user.id) {
        await client.query('ROLLBACK');

        return res.status(403).json({
          error:
            'You are not authorized to cancel this delivery.'
        });
      }

      if (
        !['PENDING', 'ASSIGNED'].includes(
          delivery.status
        )
      ) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error:
            `This delivery cannot be cancelled while it is ${delivery.status}.`
        });
      }

      const updateResult = await client.query(
        `
        UPDATE deliveries
        SET
          status = 'CANCELLED',
          cancelled_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
        `,
        [deliveryId]
      );

      await client.query(
        `
        UPDATE delivery_matches
        SET
          status = 'EXPIRED',
          responded_at = CURRENT_TIMESTAMP
        WHERE delivery_id = $1
          AND status IN ('OFFERED', 'ACCEPTED')
        `,
        [deliveryId]
      );

      await client.query('COMMIT');

      return res.json({
        success: true,
        message: 'Delivery cancelled successfully.',
        delivery: updateResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');

      console.error(
        'Delivery cancellation error:',
        error
      );

      return res.status(500).json({
        error: 'Unable to cancel delivery.'
      });
    } finally {
      client.release();
    }
  }
);



app.listen(PORT, () => console.log(`FAGA Pure Node Engine streaming live on port ${PORT} 🚀`));