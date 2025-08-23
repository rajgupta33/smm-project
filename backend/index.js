const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");
const bodyParser = require('body-parser');
const { connectToDatabase, disconnectFromDatabase } = require('./utils/serverlessDb');
const validate = require('./middelwares/validate');

const app = express();

// Define allowed origins - include your backend domain
const allowedOrigins = [
  'https://getfame.social', 
  'https://www.getfame.social',
  'https://backend.getfame.social', // Add your backend domain
  'http://localhost:3000', // For development
  'http://localhost:5173'  // For Vite dev server if using
];

// Configure CORS properly
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With', 
    'Content-Type', 
    'Accept',
    'Authorization',
    'Cache-Control',
    'X-CSRF-Token'
  ],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 200
}));

app.use(cookieParser());

// Database connection middleware
app.use(async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (err) {
    console.error('Database connection failed:', err);
    res.status(500).json({ error: "Database connection failed" });
  }
});

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('Received SIGINT. Performing graceful shutdown...');
  await disconnectFromDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM. Performing graceful shutdown...');
  await disconnectFromDatabase();
  process.exit(0);
});

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Health check route
app.get("/api/check", async (req, res) => {
    try {
        const { getConnectionStatus } = require('./utils/serverlessDb');
        const dbStatus = getConnectionStatus();
        
        res.status(200).json({ 
            msg: "all good",
            timestamp: new Date().toISOString(),
            database: dbStatus
        });
    } catch (error) {
        res.status(500).json({ 
            msg: "health check failed",
            error: error.message 
        });
    }
});

// Routes
const adminRoutes = require('./routes/adminRoutes');
app.use("/api/admin", validate, adminRoutes);

const userRoutes = require('./routes/userRoutes');
app.use('/api/user', userRoutes);

const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// ✅ FIXED: Handle 404 without using wildcard '*'
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;
