import React, { useState, useEffect } from 'react';
import { Home, User, Mail, Menu, X, ListOrderedIcon, LogOutIcon } from 'lucide-react';
import { Link } from 'react-router-dom'; // Import Link from react-router-dom
import { useAuth } from '../context/Authcontext';

// Define the link type for clarity and debugging
const NAV_ICONS = {
  Home,
  User,
  Mail,
  Menu,
  X,
  ListOrderedIcon,
  LogOutIcon,
};

const DEFAULT_BRAND = "My Website";

// Define default links for unauthenticated users
const defaultLinks = [
  { name: 'Home', href: '/home', icon: 'Home' },
  { name: 'About', href: '/about', icon: 'User' },
  { name: 'Contact', href: '/contact', icon: 'Mail' },
];

export default function ResponsiveNavbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [brandName] = useState(DEFAULT_BRAND);
  const [links, setLinks] = useState(defaultLinks);
  const auth = useAuth();
  

  useEffect(() => {
    // Ensure auth.user and auth.user.role exist before accessing
    if (auth && auth.user && auth.user.role) {
      if (auth.user.role === 'user') {
        setLinks([
          { name: 'Home', href: '/home', icon: 'Home' },
          { name: 'Payments', href: '/payments', icon: 'Mail' },
          { name: 'Orders', href: '/orders', icon: 'ListOrderedIcon' },
        ]);
      } else if (auth.user.role === 'admin') {
        setLinks([
          { name: 'Home', href: '/home', icon: 'Home' },
          { name: 'Add Payment', href: '/addPayment', icon: 'Mail' },
          { name: 'Check User', href: '/checkUser', icon: 'User' },
          { name: 'Change Password', href: '/changeUserPassword', icon: 'User' },
        ]);
      } else {
        // Fallback for roles not explicitly handled or initially loading
        setLinks(defaultLinks);
      }
    } else {
      // If auth.user or auth.user.role is not available (e.g., initial load, not authenticated)
      setLinks(defaultLinks);
    }
  }, [auth.user?.role]); // Use optional chaining to safely access auth.user.role


  
  // Helper to render Lucide icons by string name
  const getIconComponent = (iconName) => {
    if (!iconName) return null;
    const IconComponent = NAV_ICONS[iconName];
    return IconComponent ? <IconComponent className="w-5 h-5 mr-2 text-white" /> : null;
  };

  return (
    <nav className="bg-black border-b-2 border-purple-500">
      <div className="container mx-auto px-4 py-4">
        <div className="flex justify-between items-center">
          {/* Brand Logo - Now also a Link to Home */}
          <div className="flex items-center space-x-2">
            <Link to="/" className="text-xl font-bold text-white hover:text-purple-400 transition-colors duration-300">
              {brandName}
            </Link>
          </div>

          {/* Desktop Navigation */}
          <ul className="hidden md:flex space-x-8">
            {links.map((link) => (
              <li key={link.href}>
                <Link // Changed from <a> to <Link>
                  to={link.href}
                  className="flex items-center text-white hover:text-purple-400 transition-colors duration-300"
                >
                  {getIconComponent(link.icon)}
                  <span>{link.name}</span>
                </Link>
              </li>
            ))}
            {auth.user && (
              <li>
                <button
                  onClick={auth.logout}
                  className="flex items-center text-white hover:text-purple-400 transition-colors duration-300"
                >
                  {getIconComponent('LogOutIcon')}
                  <span>Logout</span>
                </button>
              </li>
            )}
          </ul>

          {/* Mobile Navigation */}
          <div className="md:hidden">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="p-2 rounded-md hover:bg-gray-800 transition-colors"
              aria-label="Toggle menu"
            >
              {isOpen ? (
                <X className="h-6 w-6 text-white" />
              ) : (
                <Menu className="h-6 w-6 text-white" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu Content */}
        <div className={`mt-4 md:hidden transition-all duration-300 ${
          isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'
        }`}>
          <ul className="space-y-4">
            {links.map((link) => (
              <li key={link.href}>
                <Link // Changed from <a> to <Link>
                  to={link.href}
                  className="flex items-center px-4 py-2 text-white hover:bg-purple-900 rounded-lg transition-colors"
                  onClick={() => setIsOpen(false)} // Close menu on link click for mobile
                >
                  {getIconComponent(link.icon)}
                  <span>{link.name}</span>
                </Link>
              </li>
            ))}
            {auth.user && (
              <li>
                <button
                  onClick={auth.logout}
                  className="flex items-center text-white hover:text-purple-400 transition-colors duration-300"
                >
                  {getIconComponent('LogOutIcon')}
                  <span>Logout</span>
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>
    </nav>
  );
}