const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");
const bodyParser = require('body-parser');
const connectDB = require('./utils/db');
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

// Remove the conflicting allowCrossDomain middleware - it's not needed

app.use(cookieParser());

// Database connection middleware
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Database connection failed:', err);
    res.status(500).json({ error: "Database connection failed" });
  }
});

app.use(bodyParser.json({ limit: '10mb' })); // Add size limit
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Health check route
app.get("/api/check", (req, res) => {
    res.status(200).json({ msg: "all good" });
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

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;
