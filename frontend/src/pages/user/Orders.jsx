import OrderCard from "../../cards/OrderCard";
import ResponsiveNavbar from "../../components/NavBar";
export default function Order(){
  const orders = [
  {
    orderId: 12345,
    service: "Premium Service",
    quantity: 2,
    status: 'pending',
    cost: 99.99
  },
  {
    orderId: 12346,
    service: "Basic Service",
    quantity: 1,
    status: 'complete',
    cost: 49.99
  },
  {
    orderId: 12347,
    service: "Standard Service",
    quantity: 3,
    status: 'cancelled',
    cost: 89.97
  },
  {
    orderId: 12348,
    service: "Premium Service",
    quantity: 1,
    status: 'pending',
    cost: 49.99
  },
  {
    orderId: 12349,
    service: "Basic Service",
    quantity: 2,
    status: 'complete',
    cost: 99.98
  }
];



  return (
    <>
      <ResponsiveNavbar />
      <div className="min-h-screen bg-black p-4 sm:p-8 flex flex-col items-center justify-center space-y-4 sm:space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-4 sm:mb-6 text-center">My Orders</h1>
        {orders.map(order => (
          <OrderCard key={order.orderId} order={order} />
        ))}
      </div>
    </>
  );
}