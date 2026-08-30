import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/Authcontext';
import OrderForm from '../../components/OrderForm';
import CreateUserForm from '../../components/CreateUserForm';
import ResponsiveNavbar from '../../components/NavBar';
import Logo from '../../components/Logo';

export default function Home() {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) navigate('/login');
  }, [auth.isLoading, auth.isAuthenticated, navigate]);

  if (auth.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-sunken">
        <div className="flex flex-col items-center gap-4">
          <Logo size="lg" linked={false} />
          <div className="h-1 w-32 overflow-hidden rounded-full bg-line">
            <div className="h-full w-1/2 animate-shimmer rounded-full bg-brand-gradient" />
          </div>
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated) return null;

  const isAdmin = auth.user?.role === 'admin';

  return (
    <div className="min-h-screen bg-surface-sunken">
      <ResponsiveNavbar />
      <main className="page">
        <header className="page-head">
          <div className="min-w-0">
            <h1 className="page-title">
              {isAdmin ? 'Create a customer' : 'Place a new order'}
            </h1>
            <p className="page-sub">
              {isAdmin
                ? 'Set up a customer account and assign the services they can buy.'
                : 'Pick a service, tell us where it goes, and we handle the rest.'}
            </p>
          </div>
        </header>

        {isAdmin ? (
          <div className="mx-auto max-w-2xl">
            <CreateUserForm />
          </div>
        ) : (
          <OrderForm />
        )}
      </main>
    </div>
  );
}
