// backend/db.js
const mongoose = require("mongoose");

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const uri = process.env.MONGO_URI;
    cached.promise = mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }).then((mongo) => {
      console.log("MongoDB connected");
      return mongoose.connection.db;
    }).catch((err) => {
      console.error("MongoDB connection error:", err);
      cached.promise = null;
      throw err;
    });
  }

  cached.conn = await cached.promise;
  return mongoose.connection.db;
}

module.exports = connectDB;
