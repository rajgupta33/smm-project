const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");
const bodyParser=require('body-parser');
const db=require('./utils/db');
const validate = require('./middelwares/validate')

const app = express();
app.use(cors({
    origin: "http://localhost:5173",
    credentials: true
}));


app.use(cookieParser());



app.use(bodyParser.json());


app.get("/check",(req,res)=>{
    res.status(200).json({msg:"all good"})
})

// Login route
const createUser=require('./routes/Admin/createUser');
app.use("/createUser", validate ,createUser);

// Create user route
const login=require('./routes/common/login');
app.use('/login',login);

//for get all services
const getServices=require('./routes/Admin/getServices');
app.use('/getServices',getServices);

//for place a order
const placeOrder=require('./routes/User/placeOrder');
app.use("/place-order",placeOrder)

const userService=require('./routes/User/getUserServices');
app.use("/userServices",validate,userService);

const me=require('./routes/common/me');
app.use('auth/me',me);

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

// Start server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});