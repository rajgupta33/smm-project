import './index.css'
import { lazy, Suspense } from 'react'
import { BrowserRouter,Route,Routes } from 'react-router-dom'
import Home from './pages/common/Home'
import Order from './pages/user/Orders'
import LoginPage from './pages/common/Login'
import { AuthProvider } from './context/Authcontext'
import Payments from './pages/user/Payments'
import AddPayment from './pages/Admin/AddPaytemnt'
import Unauthorized from './pages/user/Unauthorized'
import ChangeUserPassword from './pages/Admin/ChangeUserPassword'
import ServiceManager from './pages/Admin/CreateService'
import ProtectedRoute from './components/ProtectedRoute'
import UserProfilePage from './pages/user/UserProfilePage'
import UserDashboardPage from './pages/Admin/UserDashboardPage'
import PricingSettingsPage from './pages/Admin/PricingSettingsPage'
import PaymentReturnPage from './pages/user/PaymentReturnPage'
import AdminPaymentsPage from './pages/Admin/PaymentsPage'
import RefillsPage from './pages/Admin/RefillsPage'
import SupportPage from './pages/user/SupportPage'
import TicketsPage from './pages/Admin/TicketsPage'
import ManualTasksPage from './pages/Admin/ManualTasksPage'
import AdminOverviewPage from './pages/Admin/AdminOverviewPage'
import OrderDetailPage from './pages/user/OrderDetailPage'
import NotFound from './pages/common/NotFound'
import WhatsAppButton from './components/WhatsAppButton'

const ProviderRoutingPage = lazy(() => import('./pages/Admin/ProviderRoutingPage'))
const ReconciliationPage = lazy(() => import('./pages/Admin/ReconciliationPage'))
const AlertsPage = lazy(() => import('./pages/Admin/AlertsPage'))
const ResellersPage = lazy(() => import('./pages/Admin/ResellersPage'))
const PromoCampaignsPage = lazy(() => import('./pages/Admin/PromoCampaignsPage'))
const ResellerDashboardPage = lazy(() => import('./pages/reseller/ResellerDashboardPage'))
const ResellerMarketingPage = lazy(() => import('./pages/reseller/ResellerMarketingPage'))

const Loading = ({ label }) => (
  <div className="min-h-screen bg-surface-sunken text-ink p-6">{label}</div>
)

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <WhatsAppButton />
        <Routes>
          <Route path="/login" element={<LoginPage/>} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route path="/home" element={<Home/>}/>
          <Route path="/" element={<Home/>}/>

          {/* Admin routes */}
          <Route element={<ProtectedRoute requiredRole="admin" />}>
            <Route path="/addPayment" element={<AddPayment/>} />
            <Route path="/services" element={<ServiceManager/>}/>
            <Route path="/changeUserPassword" element={<ChangeUserPassword/>}/>
            <Route path="/userDashboard" element={<UserDashboardPage/>}/>
            <Route path="/pricing" element={<PricingSettingsPage/>}/>
            <Route path="/adminPayments" element={<AdminPaymentsPage/>}/>
            <Route path="/adminRefills" element={<RefillsPage/>}/>
            <Route path="/adminTickets" element={<TicketsPage/>}/>
            <Route path="/adminOverview" element={<AdminOverviewPage/>}/>
            <Route path="/adminManualTasks" element={<ManualTasksPage/>}/>
            <Route path="/adminProviders" element={<Suspense fallback={<div className="min-h-screen bg-surface-sunken text-ink p-6">Loading provider tools…</div>}><ProviderRoutingPage/></Suspense>}/>
            <Route path="/adminReconciliation" element={<Suspense fallback={<div className="min-h-screen bg-surface-sunken text-ink p-6">Loading reconciliation tools…</div>}><ReconciliationPage/></Suspense>}/>
            <Route path="/adminAlerts" element={<Suspense fallback={<div className="min-h-screen bg-surface-sunken text-ink p-6">Loading alerts…</div>}><AlertsPage/></Suspense>}/>
            <Route path="/adminResellers" element={<Suspense fallback={<Loading label="Loading resellers…"/>}><ResellersPage/></Suspense>}/>
            <Route path="/adminPromoCampaigns" element={<Suspense fallback={<Loading label="Loading campaigns…"/>}><PromoCampaignsPage/></Suspense>}/>
          </Route>

          {/* Reseller routes. A reseller is a customer account with a reseller
              profile, so these sit alongside the customer routes rather than
              replacing them: a reseller still orders, tops up and raises tickets. */}
          <Route element={<ProtectedRoute requiredRole="user" requireReseller />}>
            <Route path="/reseller" element={<Suspense fallback={<Loading label="Loading your earnings…"/>}><ResellerDashboardPage/></Suspense>}/>
            <Route path="/reseller/marketing" element={<Suspense fallback={<Loading label="Loading marketing…"/>}><ResellerMarketingPage/></Suspense>}/>
          </Route>

          {/* User routes */}
          <Route element={<ProtectedRoute requiredRole="user" />}>
            <Route path="/payments" element={<Payments/>} />
            <Route path="/payments/return" element={<PaymentReturnPage/>} />
            <Route path="/orders" element={<Order/>}/>
            <Route path="/orders/:orderId" element={<OrderDetailPage/>}/>
            <Route path="/profile" element={<UserProfilePage/>}/>
            <Route path="/support" element={<SupportPage/>}/>
          </Route>

          <Route path="*" element={<NotFound/>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
