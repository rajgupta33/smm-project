const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");
const bodyParser=require('body-parser');
const connectDB = require('./utils/db');
const validate = require('./middelwares/validate')

const app = express();


const allowedOrigins = ['https://getfame.social', 'https://www.getfame.social'];


app.use(cookieParser());

app.use(cors({
  origin: allowedOrigins
}));

var allowCrossDomain = function(req,res,next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();  
}
app.use(allowCrossDomain);

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ error: "Database connection failed" });
  }
});

app.use(bodyParser.json());


app.get("/api/check",(req,res)=>{
    res.status(200).json({msg:"all good"})
})

// Login route
const adminRoutes=require('./routes/adminRoutes');
app.use("/api/admin", validate ,adminRoutes);

const userRoutes = require('./routes/userRoutes');
app.use('/api/user', userRoutes);

const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);


module.exports = app;
