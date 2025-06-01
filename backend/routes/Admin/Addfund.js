const express=require('express');
const db=require('../../utils/db');
const router=express.Router();
router.put("/",async(req,res)=>{
    const {userid,money} = req.payload;
    if(req.user.role!=='admin'){
        res.status(404).json({msg:"unauthorized"});
    }
    try {
        const curr = await db.collection('users').findOne({ userid });
        if (!curr) {
            return res.status(404).json({ msg: "User not found" });
        }
        const user = await db.collection('users').updateOne(
            { userid },
            { $set: { money: curr.money + money } }
        );
        res.status(200).json({ user });
    } catch (error) {
        res.status(500).json({ msg: "Internal server error", error: error.message });
    }
})
module.exports=router;