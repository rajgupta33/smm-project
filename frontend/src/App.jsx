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

const ProviderRoutingPage = lazy(() => import('./pages/Admin/ProviderRoutingPage'))
const ReconciliationPage = lazy(() => import('./pages/Admin/ReconciliationPage'))

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
            <Route path="/adminProviders" element={<Suspense fallback={<div className="min-h-screen bg-gray-950 text-white p-6">Loading provider tools…</div>}><ProviderRoutingPage/></Suspense>}/>
            <Route path="/adminReconciliation" element={<Suspense fallback={<div className="min-h-screen bg-gray-950 text-white p-6">Loading reconciliation tools…</div>}><ReconciliationPage/></Suspense>}/>
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
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
