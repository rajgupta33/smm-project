import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ToastContainer, toast } from 'react-toastify';
import { X, Check, AlertCircle, Info } from 'lucide-react';
import ResponsiveNavbar from '../../components/NavBar';
import Cookies from "js-cookie";

const CreateUser = () => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('user');
  const [services, setServices] = useState([]);
  const [selectedServices, setSelectedServices] = useState([]);
  const [serviceRates, setServiceRates] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        if (services.length === 0) {
          setLoading(true);
          const response = await axios.get('http://localhost:3000/getServices');
          setServices(response.data.data);
        }
      } catch (error) {
        setError('Failed to fetch services. Please try again.');
        console.error('Failed to fetch services:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchServices();
  }, []);

  const handleServiceChange = (serviceId) => {
    setSelectedServices(prev => {
      const isSelected = prev.includes(serviceId);
      const newServices = isSelected 
        ? prev.filter(s => s !== serviceId)
        : [...prev, serviceId];
      
      // Reset rate when service is deselected
      if (!isSelected) {
        setServiceRates(prevRates => ({
          ...prevRates,
          [serviceId]: 0.0
        }));
      }
      
      return newServices;
    });
  };

  const handleRateChange = (serviceId, value) => {
    if (!selectedServices.includes(serviceId)) {
      toast.error('Please select the service before setting its rate', {
        icon: <AlertCircle className="text-red-500" />,
        theme: "dark",
        className: "bg-black/90 border-purple-900/30"
      });
      return;
    }

    const numericRate = parseFloat(value);
    if (isNaN(numericRate)) {
      toast.error('Rate must be a valid number', {
        icon: <AlertCircle className="text-red-500" />,
        theme: "dark",
        className: "bg-black/90 border-purple-900/30"
      });
      return;
    }

    setServiceRates(prev => ({
      ...prev,
      [serviceId]: numericRate
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!userId.trim()) {
      toast.error('User ID is required', {
        icon: <AlertCircle className="text-red-500" />,
        theme: "dark",
        className: "bg-black/90 border-purple-900/30"
      });
      return;
    }
    
    if (!password.trim()) {
      toast.error('Password is required', {
        icon: <AlertCircle className="text-red-500" />,
        theme: "dark",
        className: "bg-black/90 border-purple-900/30"
      });
      return;
    }
    
    if (password !== confirmPassword) {
      toast.error('Passwords do not match', {
        icon: <AlertCircle className="text-red-500" />,
        theme: "dark",
        className: "bg-black/90 border-purple-900/30"
      });
      return;
    }
    
    if (selectedServices.length === 0) {
      toast.error('Please select at least one service', {
        icon: <AlertCircle className="text-red-500" />,
        theme: "dark",
        className: "bg-black/90 border-purple-900/30"
      });
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      const response = await axios.post(
        'http://localhost:3000/createUser',
        {
          userId,
          password,
          role,
          services: selectedServices.map(serviceId => ({
            serviceId,
            rate: serviceRates[serviceId]
          }))
        },
        {
          withCredentials: true,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.status === 200) {
        toast.success('User created successfully!', {
          icon: <Check className="text-green-500" />,
          theme: "dark",
          className: "bg-black/90 border-purple-900/30"
        });
        toast.info(
          <div>
            <div className="font-semibold mb-1">User Created</div>
            <div>
              <span className="text-purple-400">User ID:</span> {response.data.userId}
            </div>
            <div>
              <span className="text-purple-400">Password:</span> {response.data.password}
            </div>
          </div>,
          {
            icon: <Info className="text-blue-400" />,
            theme: "dark",
            className: "bg-black/90 border-purple-900/30",
            autoClose: 10000,
            closeOnClick: true,
            pauseOnHover: true,
          }
        );
      }
    } catch (error) {
      toast.error('Failed to create user. Please try again.', {
        icon: <AlertCircle className="text-red-500" />,
        theme: "dark",
        className: "bg-black/90 border-purple-900/30"
      });
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ResponsiveNavbar />
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
        <form onSubmit={handleSubmit} className="bg-black/90 backdrop-blur-sm shadow-xl rounded-2xl max-w-md w-full p-6 space-y-6 md:p-8 transition-all duration-300 hover:shadow-2xl border border-purple-900/30">
          <h2 className="text-2xl font-bold text-center mb-6 text-purple-500">Create User Account</h2>
          
          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 text-red-500 bg-black/50 p-3 rounded-lg animate-fade-in border border-red-900/30">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}
          
          {/* User ID Input */}
          <div className="relative">
            <label htmlFor="userId" className="absolute left-3 top-3 text-sm text-purple-400 pointer-events-none transform -translate-y-2 scale-90 origin-left">
              User ID
            </label>
            <input
              id="userId"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full p-4 rounded-lg bg-black/70 border border-purple-900/30 focus:border-purple-500 focus:bg-black text-white placeholder:text-transparent"
              placeholder="Enter your user ID"
              required
            />
          </div>
          
          {/* Password Inputs */}
          <div className="grid gap-4">
            <div className="relative">
              <label htmlFor="password" className="absolute left-3 top-3 text-sm text-purple-400 pointer-events-none transform -translate-y-2 scale-90 origin-left">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-4 rounded-lg bg-black/70 border border-purple-900/30 focus:border-purple-500 focus:bg-black text-white placeholder:text-transparent"
                placeholder="Enter your password"
                required
              />
            </div>
            <div className="relative">
              <label htmlFor="confirmPassword" className="absolute left-3 top-3 text-sm text-purple-400 pointer-events-none transform -translate-y-2 scale-90 origin-left">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full p-4 rounded-lg bg-black/70 border border-purple-900/30 focus:border-purple-500 focus:bg-black text-white placeholder:text-transparent"
                placeholder="Confirm your password"
                required
              />
            </div>
          </div>
          
          {/* Role Selection */}
          <div className="relative">
            <label htmlFor="role" className="absolute left-3 top-3 text-sm text-purple-400 pointer-events-none transform -translate-y-2 scale-90 origin-left">
              Role
            </label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full p-4 rounded-lg bg-black/70 border border-purple-900/30 focus:border-purple-500 focus:bg-black appearance-none cursor-pointer text-white"
            >
              <option value="user">Regular User</option>
              <option value="admin">Administrator</option>
            </select>
          </div>
          
          {/* Services Selection */}
          <div>
            <label htmlFor="services" className="mb-3 block font-semibold text-purple-400">
              Select Services:
            </label>
            <div
              id="services"
              className="space-y-2 bg-black/50 rounded-lg p-4 overflow-auto max-h-[150px] border border-purple-900/30"
            >
              {loading ? (
                <div className="py-4 text-center text-purple-500 animate-pulse">
                  Loading available services...
                </div>
              ) : (
                services.map((service) => (
                  <div key={service.service} className="flex items-center space-x-2 p-2 rounded hover:bg-purple-900/30 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      name="service"
                      value={service.service}
                      checked={selectedServices.includes(service.service)}
                      onChange={() => handleServiceChange(service.service)}
                      className="form-checkbox text-purple-500 border-purple-700"
                    />
                    <span className="text-purple-200">{service.name}</span>
                    {selectedServices.includes(service.service) && (
                      <div className="flex-1 flex items-center justify-end">
                        <div className="flex items-center gap-2 bg-black/70 p-2 rounded-md border border-purple-900/30">
                          <span className="text-purple-400 text-sm">$</span>
                          <input
                            type="number"
                            value={serviceRates[service.service] || 0.0}
                            onChange={(e) => handleRateChange(service.service, e.target.value)}
                            className="w-20 bg-transparent text-purple-200 text-right focus:outline-none focus:border-purple-500"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          
          {/* Submit Button */}
          <button
            type="submit"
            className="w-full py-3 px-4 rounded-xl bg-purple-900 text-white font-semibold text-lg uppercase tracking-wide shadow-md hover:bg-purple-800 hover:shadow-lg active:scale-95 transition-all duration-200 ease-in-out border border-purple-700"
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <ToastContainer
          position="top-right"
          theme="dark"
          className="text-white"
          toastClassName="bg-black/90 border border-purple-900/30"
          icon={true}
        />
      </div>
    </>
  );
};

export default CreateUser;