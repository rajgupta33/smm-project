import ResponsiveNavbar from '../../components/NavBar'
import OrderForm from '../../components/OrderForm'
export default function CreateOrder(){
    return (
      <div className="flex flex-col min-h-screen bg-black">
      {/* Navbar component */}
      <ResponsiveNavbar />
      {/* Main content area for the order form */}
      <main className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-md sm:max-w-lg md:max-w-xl lg:max-w-2xl xl:max-w-3xl">
        <OrderForm />
        </div>
      </main>
      </div>
    )
}