import { useState } from 'react'
import './index.css'
import { BrowserRouter,Route,Routes } from 'react-router-dom'
import Home from './pages/common/Home'
import Order from './pages/user/Orders'
import LoginPage from './pages/common/Login'
import { AuthProvider } from './context/Authcontext'
import Payments from './pages/user/Payments'
import AddPayment from './pages/Admin/AddPaytemnt'
import Unauthorized from './pages/user/Unauthorized'
import ChangeUserPassword from './pages/Admin/ChangeUserPassword'
import CheckUser from './pages/Admin/CheckUser'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  const [count, setCount] = useState(0)

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
            <Route path="/checkUser" element={<CheckUser/>}/>
            <Route path="/changeUserPassword" element={<ChangeUserPassword/>}/>
          </Route>

          {/* User routes */}
          <Route element={<ProtectedRoute requiredRole="user" />}>
            <Route path="/payments" element={<Payments/>} />
            <Route path="/orders" element={<Order/>}/>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
