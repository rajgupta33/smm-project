import { useEffect, useState } from 'react';
import {
  Home, User, Mail, Menu, X, ListOrderedIcon, LogOutIcon, IndianRupeeIcon, Settings,
  RotateCcw, MessageSquare, Network, ShieldAlert, LayoutDashboard, ClipboardList, Wallet,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/Authcontext';
import Logo from './Logo';

const NAV_ICONS = {
  Home, User, Mail, Menu, X, ListOrderedIcon, LogOutIcon, IndianRupeeIcon, Settings,
  RotateCcw, MessageSquare, Network, ShieldAlert, LayoutDashboard, ClipboardList,
};

const USER_LINKS = [
  { name: 'Place order', href: '/home', icon: 'Home' },
  { name: 'Orders', href: '/orders', icon: 'ListOrderedIcon' },
  { name: 'Wallet', href: '/payments', icon: 'IndianRupeeIcon' },
  { name: 'Support', href: '/support', icon: 'MessageSquare' },
  { name: 'Profile', href: '/profile', icon: 'User' },
];

const ADMIN_LINKS = [
  { name: 'Overview', href: '/adminOverview', icon: 'LayoutDashboard' },
  { name: 'Create user', href: '/home', icon: 'Home' },
  { name: 'Users', href: '/userDashboard', icon: 'User' },
  { name: 'Services', href: '/services', icon: 'Settings' },
  { name: 'Pricing', href: '/pricing', icon: 'IndianRupeeIcon' },
  { name: 'Add payment', href: '/addPayment', icon: 'Mail' },
  { name: 'Payments', href: '/adminPayments', icon: 'IndianRupeeIcon' },
  { name: 'Refills', href: '/adminRefills', icon: 'RotateCcw' },
  { name: 'Tickets', href: '/adminTickets', icon: 'MessageSquare' },
  { name: 'Manual tasks', href: '/adminManualTasks', icon: 'ClipboardList' },
  { name: 'Providers', href: '/adminProviders', icon: 'Network' },
  { name: 'Reconciliation', href: '/adminReconciliation', icon: 'ShieldAlert' },
  { name: 'Passwords', href: '/changeUserPassword', icon: 'ShieldAlert' },
];

const PUBLIC_LINKS = [{ name: 'Home', href: '/home', icon: 'Home' }];

function linksForRole(role) {
  if (role === 'user') return USER_LINKS;
  if (role === 'admin') return ADMIN_LINKS;
  return PUBLIC_LINKS;
}

export default function ResponsiveNavbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const auth = useAuth();
  const role = auth.user?.role;
  const navigate = useNavigate();
  const location = useLocation();

  const links = linksForRole(role);

  // Route changes should always dismiss the drawer, including back/forward
  // navigation that does not go through an onClick handler.
  useEffect(() => { setIsOpen(false); }, [location.pathname]);

  // A fixed drawer over a scrollable body lets the page behind it scroll on
  // iOS, which reads as the menu drifting. Lock the body while it is open.
  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [isOpen]);

  const getIcon = (name, className = 'h-5 w-5') => {
    const Icon = NAV_ICONS[name];
    return Icon ? <Icon className={className} aria-hidden="true" /> : null;
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await auth.logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
      navigate('/login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  const isActive = (href) => location.pathname === href;
  // Auth context exposes the wallet in rupees, not minor units.
  const walletRupees = Number(auth.user?.wallet);
  const showWallet = role === 'user' && Number.isFinite(walletRupees);
  const walletLabel = `₹${walletRupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  return (
    <>
      <nav className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:h-[72px] sm:px-6 lg:px-8">
          <Logo size="sm" to={role ? '/home' : '/login'} className="sm:h-10" />

          <ul className="hidden items-center gap-1 lg:flex">
            {links.map((link) => (
              <li key={link.href + link.name}>
                <Link
                  to={link.href}
                  aria-current={isActive(link.href) ? 'page' : undefined}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                    ${isActive(link.href)
                      ? 'bg-surface-sunken text-ink'
                      : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'}`}
                >
                  {getIcon(link.icon, 'h-4 w-4')}
                  <span>{link.name}</span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            {showWallet && (
              <Link
                to="/payments"
                className="hidden items-center gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-2 sm:flex"
                aria-label="Wallet balance, open wallet"
              >
                <Wallet className="h-4 w-4 text-brand-magenta" aria-hidden="true" />
                <span className="tnum text-sm font-semibold text-ink">{walletLabel}</span>
              </Link>
            )}

            {auth.user && (
              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="btn-ghost btn-sm hidden lg:inline-flex"
              >
                <LogOutIcon className="h-4 w-4" aria-hidden="true" />
                <span>{isLoggingOut ? 'Logging out…' : 'Logout'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsOpen((open) => !open)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-surface-sunken lg:hidden"
              aria-label={isOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isOpen}
              aria-controls="mobile-menu"
            >
              {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-40 lg:hidden ${isOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!isOpen}
      >
        <div
          className={`absolute inset-0 bg-ink/40 transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setIsOpen(false)}
        />
        <div
          id="mobile-menu"
          className={`absolute right-0 top-0 flex h-full w-[85%] max-w-sm flex-col bg-surface shadow-lift
                      transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-4">
            <Logo size="sm" linked={false} />
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-surface-sunken"
              aria-label="Close menu"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {showWallet && (
            <Link
              to="/payments"
              className="mx-4 mt-4 flex items-center justify-between rounded-xl border border-line bg-surface-sunken px-4 py-3"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-ink-soft">
                <Wallet className="h-4 w-4 text-brand-magenta" aria-hidden="true" />
                Wallet balance
              </span>
              <span className="tnum text-base font-bold text-ink">{walletLabel}</span>
            </Link>
          )}

          <ul className="flex-1 space-y-1 overflow-y-auto p-4">
            {links.map((link) => (
              <li key={link.href + link.name}>
                <Link
                  to={link.href}
                  aria-current={isActive(link.href) ? 'page' : undefined}
                  className={`flex min-h-[48px] items-center gap-3 rounded-xl px-4 py-3 text-base font-medium transition-colors
                    ${isActive(link.href)
                      ? 'bg-brand-gradient text-white'
                      : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'}`}
                >
                  {getIcon(link.icon)}
                  <span>{link.name}</span>
                </Link>
              </li>
            ))}
          </ul>

          {auth.user && (
            <div className="border-t border-line p-4">
              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="btn-secondary btn-block"
              >
                <LogOutIcon className="h-4 w-4" aria-hidden="true" />
                <span>{isLoggingOut ? 'Logging out…' : 'Logout'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
