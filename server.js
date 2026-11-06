/**
 * ============================================================================
 * LAYER: Backend API Layer (Express.js Server)
 * Description: Implements the REST API endpoints, URL validation, random 6-character
 *              code generation, redirect logic (HTTP 302), click tracking,
 *              and static asset serving.
 * ============================================================================
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { initRedis, db } = require('./redisClient');

// Initialize the Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware 1: Parse incoming JSON request bodies
app.use(express.json());

// Middleware 2: Parse URL-encoded form bodies if needed
app.use(express.urlencoded({ extended: true }));

// Middleware 3: Serve static frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Helper function: Generates a cryptographically random, URL-friendly 6-character code
 * Using base62 characters (A-Z, a-z, 0-9)
 */
function generateRandomCode(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Helper function: Validates if a string is a well-formed HTTP/HTTPS URL
 */
function isValidUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    // Only permit standard web protocols: http and https
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

/**
 * ----------------------------------------------------------------------------
 * ENDPOINT: POST /api/shorten
 * Description: Validates the input URL, generates or validates a short code,
 *              saves the mapping to Redis, and prepends it to the recent list.
 * ----------------------------------------------------------------------------
 */
app.post('/api/shorten', async (req, res) => {
  try {
    const { url, customCode, expirySeconds } = req.body;

    // Step 1: Validate presence of the URL parameter
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'A valid URL is required.'
      });
    }

    const trimmedUrl = url.trim();

    // Step 2: Validate URL protocol and structure
    if (!isValidUrl(trimmedUrl)) {
      return res.status(400).json({
        error: 'Invalid URL format',
        message: 'The URL must be a valid web address starting with http:// or https://'
      });
    }

    let code;

    // Step 3: Handle optional custom code (Stretch Goal)
    if (customCode && typeof customCode === 'string' && customCode.trim()) {
      const sanitizedCode = customCode.trim();

      // Custom code validation: 3 to 30 characters, alphanumeric, hyphens, and underscores
      const codeRegex = /^[A-Za-z0-9_-]{3,30}$/;
      if (!codeRegex.test(sanitizedCode)) {
        return res.status(400).json({
          error: 'Invalid custom code',
          message: 'Custom code must be 3-30 characters long and contain only letters, numbers, hyphens, or underscores.'
        });
      }

      // Disallow reserved route paths to prevent collision with application routes
      const reserved = ['api', 'public', 'favicon.ico', 'robots.txt', 'health', 'recent', 'shorten'];
      if (reserved.includes(sanitizedCode.toLowerCase())) {
        return res.status(400).json({
          error: 'Reserved code',
          message: `The code "${sanitizedCode}" is a reserved system keyword. Please pick another.`
        });
      }

      // Check if code is already taken in Redis
      const exists = await db.exists(`url:${sanitizedCode}`);
      if (exists) {
        return res.status(400).json({
          error: 'Code already in use',
          message: `The short code "${sanitizedCode}" is already taken. Please choose a different one.`
        });
      }

      code = sanitizedCode;
    } else {
      // Step 4: Generate a unique random 6-character code
      let isUnique = false;
      let attempts = 0;
      while (!isUnique && attempts < 5) {
        code = generateRandomCode(6);
        const exists = await db.exists(`url:${code}`);
        if (!exists) {
          isUnique = true;
        }
        attempts++;
      }
    }

    // Step 5: Handle optional Expiration Time (Redis EX option - Stretch Goal)
    let setOptions = {};
    let parsedExpiry = null;
    if (expirySeconds && Number(expirySeconds) > 0) {
      parsedExpiry = Math.floor(Number(expirySeconds));
      setOptions.EX = parsedExpiry;
    }

    // Step 6: Store in Redis key-value store
    // Primary key: "url:<code>" -> original URL
    await db.set(`url:${code}`, trimmedUrl, setOptions);

    // Click counter key: "clicks:<code>" -> initialized to 0
    await db.set(`clicks:${code}`, 0, setOptions);

    // Metadata key: "meta:<code>" -> JSON string with timestamp & attributes
    const metadata = {
      createdAt: new Date().toISOString(),
      isCustom: Boolean(customCode && customCode.trim()),
      expiresInSeconds: parsedExpiry
    };
    await db.set(`meta:${code}`, JSON.stringify(metadata), setOptions);

    // Step 7: Push the code to the front of the "recent_links" Redis list
    await db.lRem('recent_links', 0, code);
    await db.lPush('recent_links', code);

    // Construct the fully qualified short URL
    const host = req.get('host');
    const shortUrl = `${req.protocol}://${host}/${code}`;

    // Return 201 Created with link details
    return res.status(201).json({
      code,
      short: shortUrl,
      originalUrl: trimmedUrl,
      expiresIn: parsedExpiry,
      createdAt: metadata.createdAt
    });
  } catch (err) {
    console.error('Error in POST /api/shorten:', err);
    return res.status(500).json({
      error: 'Server error',
      message: 'An internal error occurred while creating the short link.'
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * ENDPOINT: GET /api/recent
 * Description: Retrieves the 10 most recently created short links and their
 *              associated click counts using Redis lists and key lookups.
 * ----------------------------------------------------------------------------
 */
app.get('/api/recent', async (req, res) => {
  try {
    // Step 1: Fetch the last 10 codes from the "recent_links" Redis list (0 to 9)
    const codes = await db.lRange('recent_links', 0, 9);

    const host = req.get('host');
    const protocol = req.protocol;
    const links = [];

    // Step 2: Fetch details for each code from Redis
    for (const code of codes) {
      const longUrl = await db.get(`url:${code}`);

      // If the key has expired or was removed, skip it
      if (!longUrl) {
        continue;
      }

      // Fetch click counter from Redis
      const clicksRaw = await db.get(`clicks:${code}`);
      const clicks = parseInt(clicksRaw || '0', 10);

      // Fetch metadata (createdAt, isCustom)
      let metadata = {};
      const metaRaw = await db.get(`meta:${code}`);
      if (metaRaw) {
        try {
          metadata = JSON.parse(metaRaw);
        } catch (_) {}
      }

      // Fetch remaining TTL in seconds
      const ttl = await db.ttl(`url:${code}`);

      links.push({
        code,
        short: `${protocol}://${host}/${code}`,
        originalUrl: longUrl,
        clicks,
        createdAt: metadata.createdAt || null,
        isCustom: Boolean(metadata.isCustom),
        ttl: ttl > 0 ? ttl : null
      });
    }

    // Return 200 OK with recent links array
    return res.status(200).json({
      success: true,
      count: links.length,
      isFallback: db.isFallback(),
      links
    });
  } catch (err) {
    console.error('Error in GET /api/recent:', err);
    return res.status(500).json({
      error: 'Server error',
      message: 'Failed to retrieve recent links.'
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * ENDPOINT: GET /api/status
 * Description: Quick health check endpoint reporting Redis connection state
 * ----------------------------------------------------------------------------
 */
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    mode: db.isFallback() ? 'in-memory-fallback' : 'redis-connected',
    redisConnected: !db.isFallback(),
    message: db.isFallback()
      ? 'Running in graceful in-memory fallback. Run `docker run -p 6379:6379 redis` for real Redis persistence.'
      : 'Connected to Redis server'
  });
});

/**
 * ----------------------------------------------------------------------------
 * ENDPOINT: GET /:code
 * Description: Redirects visitor (HTTP 302) to the original long URL stored
 *              in Redis and atomically increments the click counter.
 * ----------------------------------------------------------------------------
 */
app.get('/:code', async (req, res, next) => {
  try {
    const code = req.params.code;

    // Filter out static asset requests or system files
    if (code.includes('.') || code === 'api') {
      return next();
    }

    // Lookup original URL in Redis
    const originalUrl = await db.get(`url:${code}`);

    if (!originalUrl) {
      // Return a clean, user-friendly 404 page
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>404 - Link Not Found | QuickLink</title>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
          <style>
            body { background: #0f172a; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
            .card-404 { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 2.5rem; text-align: center; max-width: 480px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
          </style>
        </head>
        <body>
          <div class="card-404">
            <div class="mb-3 text-warning"><i class="bi bi-exclamation-triangle-fill" style="font-size: 3rem;"></i></div>
            <h1 class="h3 fw-bold mb-2">Short Link Not Found</h1>
            <p class="text-secondary mb-4">The link <code>/${code}</code> does not exist, or it may have reached its expiration time.</p>
            <a href="/" class="btn btn-primary px-4 py-2"><i class="bi bi-house-door me-2"></i>Return to Homepage</a>
          </div>
        </body>
        </html>
      `);
    }

    // Atomically increment the click counter in Redis
    // Redis command: INCR clicks:<code>
    await db.incr(`clicks:${code}`);

    // Perform HTTP 302 Found redirect to original destination
    return res.redirect(302, originalUrl);
  } catch (err) {
    console.error(`Error redirecting for code "${req.params.code}":`, err);
    return res.status(500).send('An error occurred during link redirection.');
  }
});

/**
 * ----------------------------------------------------------------------------
 * Server Startup & Initialization
 * ----------------------------------------------------------------------------
 */
async function startServer() {
  // Step 1: Connect to Redis (or activate fallback if server is offline)
  await initRedis();

  // Step 2: Seed initial sample records into Redis on first run
  await db.seedInitialData();

  // Step 3: Listen on designated HTTP port
  app.listen(PORT, () => {
    console.log(`🚀 [Server Layer] URL Shortener server is running at: http://localhost:${PORT}`);
    console.log(`🌐 [Server Layer] Open http://localhost:${PORT} in your web browser`);
  });
}

// Start the server
startServer();
