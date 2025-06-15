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
app.use("/createUser", validate, createUser);

// Create user route
const login=require('./routes/common/login');
app.use('/login',login);

//for get all services
const getServices=require('./routes/Admin/getServices');
app.use('/getServices', validate, getServices);

//for place a order
const placeOrder=require('./routes/User/placeOrder');
app.use("/placeOrder", validate, placeOrder)

const userService=require('./routes/User/getUserServices');
app.use("/userServices", validate, userService);

const me=require('./routes/common/me');
app.use('auth/me', validate, me);

const getOrders = require('./routes/User/getOrders')
app.use('/getOrders', validate, getOrders);

const getTransactions =require('./routes/User/getTransactions');
app.use('/getTransactions', validate, getTransactions);

const createService = require('./routes/Admin/createService');
app.use('/createService', validate , createService);

const updateService = require('./routes/Admin/updateService');
app.use('/updateService', validate, updateService);

const getCustomServices = require('./routes/Admin/getCustomServices');
app.use('/getCustomServices', validate, getCustomServices);

const addBalance = require('./routes/Admin/addBalance');
app.use('/addBalance', validate, addBalance);

const changePassword = require('./routes/User/changePassword');
app.use('/changePassword', validate, changePassword);

const changeUserPassword = require('./routes/Admin/changeUserPassword');
app.use('/changeUserPassword', validate, changeUserPassword);

const getUser = require('./routes/Admin/getUser');
app.use('/getUser', validate, getUser);

// Start server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});