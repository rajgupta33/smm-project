import TransactionCard from "../../cards/TransactionCard";
import ResponsiveNavbar from "../../components/NavBar";

export default function Payments(){
    const payments = [
  {
    amount: 99.99,
    orderId: 12345,
    date: new Date('2025-05-30')
  },
  {
    amount: 49.99,
    orderId: 12346,
    date: new Date('2025-05-29')
  },
  {
    amount: 89.97,
    orderId: 12347,
    date: new Date('2025-05-28')
  },
  {
    amount: 49.99,
    orderId: 12348,
    date: new Date('2025-05-31')
  },
  {
    amount: 99.98,
    orderId: 12349,
    date: new Date('2025-05-27')
  }
];

  return (
    <>
      <ResponsiveNavbar />
      <div className="min-h-screen bg-black flex flex-col items-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-6 text-center">
            Recent Transactions
          </h1>
          {payments.map((payment, idx) => (
            <TransactionCard key={payment.orderId || idx} payment={payment} />
          ))}
        </div>
      </div>
    </>
  );
}