const express=require('express');
const router=express.Router();
router.post("/",(req,res)=>{
    console.log(req.body);
    res.status(200).json({msg:"all good"});
})
module.exports=router;