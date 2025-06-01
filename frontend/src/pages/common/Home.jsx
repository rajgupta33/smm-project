import { useAuth } from "../../context/Authcontext";
import CreateOrder from "../user/CreateOrder";
import CreateUser from "../Admin/CreateUser";
import {useNavigate} from "react-router-dom"
import { useEffect } from "react";
export default function Home(){
    
    const auth=useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!auth.isAuthenticated) {
            navigate("/login");
            return;
        }
    }, [auth.user, navigate]);
    return auth.user.role !== 'admin' ? (
        <CreateOrder/>
    ) : (
        <CreateUser />
    );
}