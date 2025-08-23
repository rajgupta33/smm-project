const { connectToDatabase } = require('../utils/serverlessDb');
const app = require('../index');

// Export the app for Vercel serverless functions
module.exports = async (req, res) => {
  try {
    // Ensure MongoDB connection before handling the request
    await connectToDatabase();
    
    // Handle the request using the Express app
    return app(req, res);
  } catch (error) {
    console.error('Serverless function error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
