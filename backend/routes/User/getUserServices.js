const express=require('express');
const router=express.Router();
const db=require('../../utils/db');
const axios=require('axios');
require('dotenv').config();
const API_URL=process.env.API_URL;
const API_KEY=process.env.API_KEY;
router.get("/",async(req,res)=>{
    try {
        // Example query, replace with your actual logic
        // Fetch the user from the database
        
        const user = await db.collection('users').findOne({ userId: req.user.id });

        // Fetch all services from the external API
        const response = await axios.post(
            API_URL,
            new URLSearchParams({
            key: API_KEY,
            action: 'services'
            })
        );
        const map=new Map();

        
        // Filter services based on user's allowed services
        user.services.map((serv)=>{
            map.set(serv.serviceId, serv.rate);
        })

        

        const filteredServices = response.data.filter(service =>
            map.has(service.service)
        );

        

        const arr=filteredServices.map(serv => {serv.rate = map.get(serv.service)
            return serv;
        });
        
        
        // Respond with the filtered services
        res.status(200).json({ data: arr });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Server error' });
    }
})
module.exports=router;