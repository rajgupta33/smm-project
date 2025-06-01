import ResponsiveNavbar from '../../components/NavBar'
import PaymentForm from '../../components/PaymentForm'

export default function AddPayment(){
    return (
        <div className="min-h-screen bg-black">
            <ResponsiveNavbar />
            <div className="max-w-xl mx-auto p-8">
                <PaymentForm />
            </div>
        </div>
    );
}