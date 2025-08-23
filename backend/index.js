const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");
const bodyParser = require('body-parser');
const connectDB = require('./utils/db');
const validate = require('./middlewares/validate'); // Fixed typo: "middlewares"

const app = express();

// Define allowed origins
const allowedOrigins = [
  'https://getfame.social', 
  'https://www.getfame.social',
  'http://localhost:3000', // Add for local development
  'http://localhost:5173'  // Add for Vite dev server
];

// Configure CORS properly
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Important for cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin'
  ]
}));

// Remove the conflicting allowCrossDomain middleware entirely
// app.use(allowCrossDomain); // DELETE THIS

// Middleware setup in correct order
app.use(cookieParser());
app.use(bodyParser.json({ limit: '10mb' })); // Add size limit
app.use(bodyParser.urlencoded({ extended: true }));

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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;
