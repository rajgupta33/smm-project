import ResponsiveNavbar from '../../components/NavBar'
import ChangePasswordForm from '../../components/ChangePassword'
export default function ChangeUserPassword(){
    return (
        <div className="min-h-screen bg-black">
            <ResponsiveNavbar />
            <ChangePasswordForm />
        </div>
    )
}