const router=express.Router();
const bcrypt=require('bcrypt');
const connectDB=require('../../utils/db');
router.put("/",async(req,res)=>{
    const {userid , password} = req.payload;
    if(req.user.role!=='admin'){
        res.status(400).json({msg:"you are not a admin"});
    }
    try {
        const newPassword = await bcrypt.hash(password, 10);

        const db = await connectDB();

        const user = await db.collection('users').updateOne(
            { userid },
            { $set: { password: newPassword } }
        );
        user.password=password;

        res.status(200).json({ user });
    } catch (error) {
        res.status(500).json({ msg: "Internal server error", error: error.message });
    }

});
module.exports=router;