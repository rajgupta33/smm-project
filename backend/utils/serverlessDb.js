const mongoose = require('mongoose');
const automaticSchemaChanges = process.env.NODE_ENV !== 'production'
  && process.env.MONGOOSE_MIGRATION_MODE !== 'true';

// Connection state
let isConnected = false;
let connectionPromise = null;

const connectOptions = {
  bufferCommands: false, // Disable mongoose buffering
  autoCreate: automaticSchemaChanges,
  autoIndex: automaticSchemaChanges,
  maxPoolSize: 5, // Smaller pool size for serverless
  minPoolSize: 1, // Maintain at least 1 connection
  serverSelectionTimeoutMS: 5000, // Fail fast
  socketTimeoutMS: 30000, // Shorter timeout for serverless
  family: 4, // Use IPv4
  retryWrites: true,
  w: 'majority',
  // Serverless-specific optimizations
  maxIdleTimeMS: 15000, // Close idle connections faster
  compressors: ['zlib'],
  zlibCompressionLevel: 6,
  // Connection pool settings
  maxConnecting: 2, // Limit concurrent connection attempts
  heartbeatFrequencyMS: 10000, // Heartbeat every 10 seconds
};

/**
 * Connect to MongoDB with serverless-optimized settings
 */
async function connectToDatabase() {
  if (isConnected) {
    return mongoose.connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  const MONGODB_URI = process.env.MONGO_URI;
  
  if (!MONGODB_URI) {
    throw new Error('MONGO_URI environment variable is not defined');
  }

  connectionPromise = mongoose.connect(MONGODB_URI, connectOptions)
    .then((mongoose) => {
      isConnected = true;
      console.log('✅ MongoDB connected successfully');
      
      // Set up connection event handlers
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
        isConnected = false;
        connectionPromise = null;
      });

      mongoose.connection.on('disconnected', () => {
        console.log('🔌 MongoDB disconnected');
        isConnected = false;
        connectionPromise = null;
      });

      return mongoose.connection;
    })
    .catch((error) => {
      console.error('❌ Failed to connect to MongoDB:', error);
      isConnected = false;
      connectionPromise = null;
      throw error;
    });

  return connectionPromise;
}

/**
 * Disconnect from MongoDB
 */
async function disconnectFromDatabase() {
  if (isConnected) {
    try {
      await mongoose.disconnect();
      isConnected = false;
      connectionPromise = null;
      console.log('🔌 MongoDB disconnected successfully');
    } catch (error) {
      console.error('❌ Error disconnecting from MongoDB:', error);
      throw error;
    }
  }
}

/**
 * Get database connection status
 */
function getConnectionStatus() {
  return {
    isConnected,
    hasConnectionPromise: !!connectionPromise,
    readyState: mongoose.connection.readyState
  };
}

module.exports = {
  connectToDatabase,
  disconnectFromDatabase,
  getConnectionStatus
};
