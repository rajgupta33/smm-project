const express=require('express');
const router=express.Router();
const connectDB=require('../../utils/db');

router('/getData',async(req,res)=>{
    const userid=req.user.userid;
    const db=await connectDB();
    const user=db.collection('users').findOne({userid});
    if(!user){
        res.status(402).json({message:"not found data"});
    }
    res.status(200).json({user});
})
module.exports=router;