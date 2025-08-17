const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");
const bodyParser=require('body-parser');
const connectDB = require('./utils/db');
const validate = require('./middelwares/validate')

const app = express();


app.use(cookieParser());


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
const createUser=require('./routes/Admin/createUser');
app.use("/api/createUser", validate ,createUser);

// Create user route
const login=require('./routes/common/login');
app.use('/api/login',login);

//for get all services
const getServices=require('./routes/Admin/getServices');
app.use('/api/getServices',getServices);

//for place a order
const placeOrder=require('./routes/User/placeOrder');
app.use("/api/place-order",placeOrder)

const userService=require('./routes/User/getUserServices');
app.use("/api/userServices",validate,userService);

const me=require('./routes/common/me');
app.use('/api/auth/me',me);

// Update password route
// app.put('/users/:username/password', (req, res) => {
//     const { username } = req.params;
//     const { newPassword } = req.body;
//     if (!users[username]) {
//         return res.status(404).json({ message: 'User not found' });
//     }
//     users[username].password = newPassword;
//     res.json({ message: 'Password updated' });
// });



module.exports = app;
