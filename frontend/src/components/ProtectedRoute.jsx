import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/Authcontext';

const ProtectedRoute = ({ requiredRole }) => {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>; // Or a spinner
  }

  if (!isAuthenticated) return <Navigate to="/login" />;
  if (requiredRole && user.role !== requiredRole) return <Navigate to="/unauthorized" />;

  return <Outlet />;
};

export default ProtectedRoute;
