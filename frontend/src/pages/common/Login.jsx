import { useEffect, useState } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import { Eye, EyeOff, Lock, ShieldCheck, User, Zap, HeadphonesIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/Authcontext';
import { authApi } from '../../service/api';
import Logo from '../../components/Logo';

const TRUST_POINTS = [
  { icon: ShieldCheck, title: 'Secure payments', body: 'Every top-up is verified server-side before your balance changes.' },
  { icon: Zap, title: 'Automatic delivery', body: 'Orders reach our providers within seconds and update on their own.' },
  { icon: HeadphonesIcon, title: 'Real support', body: 'Reach a human on WhatsApp whenever something needs attention.' },
];

export default function LoginPage() {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.isLoading && auth.isAuthenticated) navigate('/home');
  }, [auth.isLoading, auth.isAuthenticated, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!userId.trim()) return toast.error('Enter your user ID to continue.');
    if (!password.trim()) return toast.error('Enter your password to continue.');

    try {
      setLoading(true);
      const response = await authApi.login({ userId: userId.trim(), password });
      if (response.success) {
        toast.success('Welcome back!', { autoClose: 1500 });
        auth.login(response.data.userId, response.data.role, response.data.money);
      } else {
        toast.error(response.message || 'Those details did not match an account.');
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error(
        error.response?.status === 401
          ? 'Those details did not match an account.'
          : 'Could not sign you in just now. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <div className="min-h-screen bg-surface-sunken lg:grid lg:grid-cols-2">
      {/* Brand / trust panel - desktop only */}
      <aside className="relative hidden overflow-hidden bg-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-25 blur-3xl"
          style={{ background: 'linear-gradient(95deg,#E8106B,#B92CB0 48%,#2E7BE8)' }}
          aria-hidden="true"
        />
        <div className="relative">
          <div className="inline-flex rounded-2xl bg-white px-5 py-4">
            <Logo size="md" linked={false} />
          </div>
          <h1 className="mt-10 max-w-md text-4xl font-bold leading-tight text-white">
            Grow your audience,{' '}
            <span className="bg-gradient-to-r from-brand-pink via-brand-magenta to-brand-blue bg-clip-text text-transparent">
              without the guesswork
            </span>
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/70">
            Order social media growth services, track every order in real time, and keep your
            wallet topped up securely.
          </p>
        </div>

        <ul className="relative mt-12 space-y-6">
          {TRUST_POINTS.map((point) => {
            const Icon = point.icon;
            return (
              <li key={point.title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
                  <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-semibold text-white">{point.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-white/60">{point.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Form */}
      <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6 lg:min-h-0">
        <div className="w-full max-w-md animate-riseIn">
          <div className="mb-8 flex flex-col items-center lg:hidden">
            <Logo size="lg" linked={false} />
            <p className="mt-3 text-center text-sm text-ink-muted">
              Sign in to place orders and manage your wallet.
            </p>
          </div>

          <div className="card card-p sm:p-8">
            <div className="mb-6 hidden lg:block">
              <h2 className="text-2xl font-bold text-ink">Sign in</h2>
              <p className="page-sub">Welcome back. Enter your details to continue.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="field">
                <label htmlFor="userId" className="label">User ID</label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
                  <input
                    id="userId"
                    type="text"
                    autoComplete="username"
                    inputMode="text"
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                    className="input pl-11"
                    placeholder="your user ID"
                    required
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="password" className="label">Password</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="input pl-11 pr-12"
                    placeholder="your password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <button type="submit" className="btn-primary btn-block text-base" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p className="mt-6 flex items-center justify-center gap-2 text-xs text-ink-muted">
              <ShieldCheck className="h-4 w-4 text-state-success" aria-hidden="true" />
              Protected by encrypted, server-verified sessions
            </p>
          </div>

          <p className="mt-6 text-center text-sm text-ink-muted">
            Need an account or lost access?{' '}
            <a
              href="https://wa.me/917906755171"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-magenta hover:underline"
            >
              Message us on WhatsApp
            </a>
          </p>
        </div>
      </main>

      <ToastContainer position="top-center" autoClose={4000} newestOnTop closeOnClick theme="light" />
    </div>
  );
}
