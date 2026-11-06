# FlashLink ⚡ - High-Performance Redis URL Shortener

A lightweight, beginner-friendly URL Shortener application built with **Node.js**, **Express**, **Bootstrap 5**, and **Redis**.

---

## 🌟 Why Redis Suits a URL Shortener Application

Redis is an **in-memory, key-value data store** known for extraordinary speed and low latency. For a URL Shortener, Redis is the ideal persistence choice for several architectural reasons:

1. **Sub-Millisecond Read Latency ($O(1)$ Lookups):**
   - URL shorteners are heavily **read-heavy** (often 100:1 read-to-write ratio). When a user clicks a short link (`http://localhost:3000/xyz123`), the lookup must happen instantly before returning an `HTTP 302` redirect.
   - Traditional relational databases (PostgreSQL, MySQL) write to disk and query B-Trees with indexing overhead. Redis retrieves `GET url:<code>` straight from RAM in microseconds with constant time complexity $O(1)$.

2. **Atomic Click Counting with Native `INCR`:**
   - Tracking total link clicks across thousands of concurrent visitors is prone to race conditions in standard SQL without row locking or transactional overhead.
   - Redis provides the native atomic command `INCR clicks:<code>`. It increments the counter safely in memory without mutex locks or concurrency conflicts.

3. **Built-in Time-To-Live Expiration (`EX` / `TTL`):**
   - Expiring short links typically requires scheduling background cron workers or running heavy database deletion queries (`DELETE FROM links WHERE expires_at < NOW()`).
   - Redis handles this natively: setting a key with `SET key value EX seconds` instructs Redis to automatically purge the link when the timer expires, without application-level cleanup overhead.

4. **Ordered Lists for Recent Activity:**
   - Using Redis lists (`LPUSH recent_links <code>` and `LRANGE recent_links 0 9`), we maintain the last 10 shortened links with minimal CPU overhead.

---

## 🏗️ Architecture & Layer Separation

This project strictly adheres to a **three-tier architecture** with clear separation of concerns:

```
url_shortener/
├── server.js            # [Backend API Layer] Express routes, validation, HTTP 302 redirects
├── redisClient.js       # [Database Layer] Redis client, atomic operations, TTL, seeding
├── public/              # [Frontend Layer] Single-page UI
│   ├── index.html       # HTML5 structure styled with Bootstrap 5 (CDN)
│   └── app.js           # Vanilla JavaScript for DOM, AJAX, copy actions, and toasts
├── package.json         # Pinned npm dependencies & scripts
└── README.md            # Documentation & setup instructions
```

*Every file contains a header comment identifying which layer it belongs to.*

---

## 🚀 Features

- **URL Shortening:** Paste any valid `http://` or `https://` link and click "Shorten" to generate a compact 6-character random code (e.g., `http://localhost:3000/aB3x9Q`).
- **One-Click Copy & Visual Feedback:** Copy the generated short link to your clipboard with instant visual feedback and notification toasts.
- **HTTP 302 Redirect & Atomic Click Tracker:** Visiting the short link redirects to the original destination while atomically incrementing `clicks:<code>` in Redis.
- **Recent Links Table:** Displays the 10 most recent links with live click counts, creation timestamps, and expiration status using Redis `LPUSH` and `LRANGE`.
- **First-Run Database Seeding:** Automatically seeds the database on first run with 4 sample links (`/redis`, `/nodejs`, `/express`, `/github`).
- **Stretch Goals Included:**
  - **Custom Short Code / Alias:** Choose a custom readable slug (e.g., `/my-portfolio` or `/summer-sale`) with duplicate detection and reserved keyword protection.
  - **Link Expiration (Redis `EX`):** Set an expiry duration (10 mins, 1 hour, 24 hours, 7 days) utilizing native Redis key expiration.

---

## 📋 Prerequisites

Before running the application, make sure you have installed:
1. **Node.js** (v18.0.0 or higher recommended). Download from [nodejs.org](https://nodejs.org).
2. **Docker Desktop** (or a local Redis server). Download from [docker.com](https://www.docker.com).

> **Note on Graceful Fallback:** If Docker is not yet running on your computer, FlashLink includes an automatic in-memory fallback store so you can test the interface and endpoints immediately without crashes!

---

## 🛠️ Step-by-Step Setup & Run Instructions

### Step 1: Open Terminal in the Project Directory

```powershell
cd "url_shortener"
```

### Step 2: Install Dependencies

All dependencies are pinned in `package.json` for reproducibility:

```powershell
npm install
```

### Step 3: Run Redis with Docker

Start an official Redis container running on port `6379`:

```powershell
docker run -d -p 6379:6379 --name redis-url-shortener redis:alpine
```

To stop Redis later:
```powershell
docker stop redis-url-shortener
```

To restart an existing Redis container:
```powershell
docker start redis-url-shortener
```

### Step 4: Start the Node.js Server

Start the application:

```powershell
npm start
```

Or run with automatic reload during development:

```powershell
npm run dev
```

### Step 5: Open in Web Browser

Open your browser and navigate to:
```
http://localhost:3000
```

---

## 📡 API Endpoints Reference

| Method | Endpoint | Description | Status Codes |
|---|---|---|---|
| `POST` | `/api/shorten` | Shortens a URL, saves to Redis, optional custom code & TTL | `201 Created`, `400 Bad Request`, `500 Server Error` |
| `GET` | `/api/recent` | Returns the 10 most recent links with click counts | `200 OK`, `500 Server Error` |
| `GET` | `/api/status` | Returns Redis connection health status | `200 OK` |
| `GET` | `/:code` | Redirects (`302`) to the original URL & increments clicks | `302 Found`, `404 Not Found` |

### Example POST `/api/shorten`

**Request Body:**
```json
{
  "url": "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
  "customCode": "mdn-js",
  "expirySeconds": 86400
}
```

**Response (`201 Created`):**
```json
{
  "code": "mdn-js",
  "short": "http://localhost:3000/mdn-js",
  "originalUrl": "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
  "expiresIn": 86400,
  "createdAt": "2026-10-26T11:00:00.000Z"
}
```

---

## 🗄️ Redis Key Schema

| Key Format | Data Type | Purpose | Example |
|---|---|---|---|
| `url:<code>` | String | Maps short code to the long target URL | `url:mdn-js` &rarr; `"https://developer.mozilla.org/..."` |
| `clicks:<code>` | String / Integer | Atomic counter incremented on every 302 redirect | `clicks:mdn-js` &rarr; `"42"` |
| `meta:<code>` | String (JSON) | Stores creation timestamp and custom alias flags | `meta:mdn-js` &rarr; `{"createdAt":"...", "isCustom":true}` |
| `recent_links` | List | Stores the most recently shortened link codes in reverse order | `["mdn-js", "github", "express", ...]` |
| `app:seeded` | String | Flag to guarantee database seeding runs only once | `"true"` |

---

## 🧪 Testing the Application

1. **Shorten a New URL:** Paste `https://en.wikipedia.org/wiki/Redis` into the input box and click **Shorten**.
2. **Copy the Link:** Click the **Copy Link** button and verify the toast appears.
3. **Test the Redirect:** Click the **Visit (302)** button or open the link in a new tab. You will be redirected to the original page immediately.
4. **Check the Counter:** Return to `http://localhost:3000` and click **Refresh** on the Recent Links table. Notice that the click count has incremented!
5. **Try Custom Codes & Expirations:** Click **Advanced options**, enter a custom slug like `my-test`, select **10 Minutes**, and verify custom creation.
