import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/Authcontext';

/**
 * Route guard. This is navigation convenience only, never a security boundary:
 * every privileged API re-checks the role and, for reseller routes, the
 * reseller profile against the database on each request.
 */
const ProtectedRoute = ({ requiredRole, requireReseller = false }) => {
  const { isAuthenticated, user, isLoading } = useAuth();

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Redirect to unauthorized if role doesn't match
  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requireReseller && !user.isReseller) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
