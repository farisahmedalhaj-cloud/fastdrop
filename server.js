require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const restaurantRoutes = require('./routes/restaurants');
const pharmacyRoutes = require('./routes/pharmacies');
const orderRoutes = require('./routes/orders');
const favoriteRoutes = require('./routes/favorites');
const reviewRoutes = require('./routes/reviews');
const ownerRoutes = require('./routes/owner');
const uploadRoutes = require('./routes/uploads');

const app = express();

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow uploaded images to render on the frontend origin
}));
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);

// Serve uploaded images/prescriptions
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'fastdrop-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/pharmacies', pharmacyRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/uploads', uploadRoutes);

// 404 handler
app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود.' }));

// Central error handler: never leak stack traces, SQL errors, or secrets.
app.use((err, req, res, next) => {
  console.error(err);
  const message =
    process.env.NODE_ENV === 'production'
      ? 'حدث خطأ غير متوقع في السيرفر.'
      : err.message || 'حدث خطأ غير متوقع في السيرفر.';
  res.status(err.status || 500).json({ error: message });
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`FastDrop backend running on http://localhost:${PORT}`);
});

// Graceful shutdown: close the HTTP server and the SQLite connection
// explicitly. This avoids a known native-addon crash on newer Node.js
// versions (22+) where better-sqlite3's internal objects can trigger a
// fatal assertion if torn down implicitly during Node's own process-exit
// cleanup instead of being closed first.
function shutdown() {
  server.close(() => {
    try {
      require('./db').close();
    } catch (e) {
      /* already closed */
    }
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
