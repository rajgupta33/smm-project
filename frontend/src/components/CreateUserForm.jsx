import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { AlertCircle, Check, Info, Trash2, X } from 'lucide-react'; // Added Trash2 and X for delete and modal
import { serviceApi } from '../service/api'

// NEW: Delete Confirmation Modal Component (Reused/adapted from previous context)
const DeleteConfirmationModal = ({ isOpen, onClose, onConfirm, service }) => {
  if (!isOpen || !service) return null;
  return (
    <div className="fixed inset-0 bg-surface bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-surface p-6 rounded-lg shadow-lift max-w-sm w-full border border-red-700 relative">
        <button onClick={onClose} className="absolute top-3 right-3 text-ink-muted hover:text-white transition-colors">
          <X size={24} />
        </button>
        <h2 className="text-xl font-bold text-state-danger mb-4 text-center">Confirm Service Deletion</h2>
        <p className="text-ink text-center mb-6">
          Are you sure you want to delete the service: <br />
          <span className="font-semibold text-ink-muted">"{service.name || service.internalName}" (ID: {service.serviceId})</span>?
          This action cannot be undone.
        </p>
        <div className="flex justify-around gap-4">
          <button onClick={onClose} className="flex-1 py-2 px-4 bg-surface-sunken hover:bg-surface-sunken text-ink rounded-md transition duration-300">
            Cancel
          </button>
          <button onClick={onConfirm} className="flex-1 py-2 px-4 bg-state-danger text-white hover:brightness-110 text-white font-semibold rounded-md transition duration-300">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};


const CreateUserForm = () => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('user');
  const [services, setServices] = useState([]); // List of all available services
  const [selectedServices, setSelectedServices] = useState([]); // List of serviceIds of selected services
  const [loading, setLoading] = useState(false); // Loading state for form submission
  const [servicesLoading, setServicesLoading] = useState(false); // Loading state for fetching services
  const [fetchError, setFetchError] = useState(null); // Error state for fetching services

  // NEW: State for delete confirmation modal
  const [isDeleteConfirmModalOpen, setIsDeleteConfirmModalOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState(null); // Stores the service object to be deleted

  // useEffect to fetch services when the component mounts
  useEffect(() => {
    const fetchServices = async () => {
      try {
        setServicesLoading(true);
        setFetchError(null);
        // Assuming serviceApi.customServices() returns { data: [servicesArray] }
        const response = await serviceApi.customServices(); // Using getCustomServices as it's the right source for assignable
        setServices(response.data.data || response.data); // Adjust based on actual response structure
      } catch (error) {
        setFetchError('Failed to fetch services. Please try again.');
        console.error('Failed to fetch services:', error);
      } finally {
        setServicesLoading(false);
      }
    };
    fetchServices();
  }, []); // Empty dependency array means this runs once on mount

  /**
   * Handles the change event for service checkboxes.
   * Adds or removes the serviceId from the selectedServices array.
   * @param {string} serviceId - The ID of the service being toggled.
   */
  const handleServiceChange = (serviceId) => {
    setSelectedServices(prev => {
      const isSelected = prev.includes(serviceId);
      return isSelected
        ? prev.filter(s => s !== serviceId) // Deselect
        : [...prev, serviceId]; // Select
    });
  };

  /**
   * NEW: Initiates the delete confirmation process for a service.
   * @param {object} service - The service object to be deleted.
   */
  const confirmDeleteService = (service) => {
    setServiceToDelete(service);
    setIsDeleteConfirmModalOpen(true);
  };

  /**
   * NEW: Handles the actual deletion of a service after confirmation.
   */
  const handleDeleteService = async () => {
    if (!serviceToDelete) return;

    setIsDeleteConfirmModalOpen(false); // Close modal immediately
    setServicesLoading(true); // Indicate loading for the deletion operation

    try {
      const loadingToastId = toast.loading(`Deleting service "${serviceToDelete.name || serviceToDelete.internalName}"...`, { theme: "dark" });
      
      // Call your serviceApi to delete the custom service by its serviceId
      const response = await serviceApi.deleteCustomServices({ serviceId: serviceToDelete.serviceId });

      if (response.success) {
        // Remove the deleted service from the local 'services' state
        setServices(prevServices => prevServices.filter(s => s.serviceId !== serviceToDelete.serviceId));
        // Also remove from selectedServices if it was selected
        setSelectedServices(prevSelected => prevSelected.filter(sId => sId !== serviceToDelete.serviceId));

        toast.update(loadingToastId, {
          render: `Service "${serviceToDelete.name || serviceToDelete.internalName}" deleted successfully!`,
          type: "success", isLoading: false, autoClose: 3000, theme: "dark"
        });
      } else {
        toast.update(loadingToastId, {
          render: `Failed to delete service: ${response.message}`,
          type: "error", isLoading: false, autoClose: 5000, theme: "dark"
        });
      }
    } catch (error) {
      console.error("Error deleting service:", error);
      const errorMessage = error.response?.data?.message || error.message || 'An unexpected error occurred.';
      toast.error(`Failed to delete service: ${errorMessage}`, { theme: "dark" });
    } finally {
      setServicesLoading(false);
      setServiceToDelete(null); // Clear the service to delete
    }
  };


  /**
   * Handles the form submission for creating a new user.
   * Performs client-side validation and sends data to the mock backend.
   * Displays toast notifications for success, error, and info messages.
   * @param {Object} e - The form submission event.
   */
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Client-side validation checks
    if (!userId.trim()) {
      toast.error('User ID is required', {
        icon: <AlertCircle className="text-state-danger" />,
        theme: "dark",
        className: "bg-surface border-line"
      });
      return;
    }

    if (!password.trim()) {
      toast.error('Password is required', {
        icon: <AlertCircle className="text-state-danger" />,
        theme: "dark",
        className: "bg-surface border-line"
      });
      return;
    }

    if (password.length < 6) { // Example: Minimum password length
        toast.error('Password must be at least 6 characters long.', {
            icon: <AlertCircle className="text-state-danger" />,
            theme: "dark",
            className: "bg-surface border-line"
        });
        return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match', {
        icon: <AlertCircle className="text-state-danger" />,
        theme: "dark",
        className: "bg-surface border-line"
      });
      return;
    }

    if (selectedServices.length === 0) {
      toast.error('Please select at least one service', {
        icon: <AlertCircle className="text-state-danger" />,
        theme: "dark",
        className: "bg-surface border-line"
      });
      return;
    }

    try {
      setLoading(true); // Indicate submission is in progress

      // Send the request to the backend
    const response = await serviceApi.createUser({
      userId,
      password,
      role,
      services: selectedServices
    });

      setLoading(false); // Clear loading immediately after response

      if (response.success) {
        // Show success toast immediately
        toast.success('User created successfully!', {
          icon: <Check className="text-state-success" />,
          theme: "dark",
          className: "bg-surface border-line"
        });

        // Show info toast with user details, delayed to allow success toast to be seen
        setTimeout(() => {
          toast.info(
            <div>
              <div className="font-semibold mb-1">User Created</div>
              <div>
                <span className="text-ink-muted">User ID:</span> {response.data.userId}
              </div>
              <div>
                <span className="text-ink-muted">Password:</span> {response.data.password}
              </div>
            </div>,
            {
              icon: <Info className="text-blue-400" />,
              theme: "dark",
              className: "bg-surface border-line",
              autoClose: 10000, // Stays open longer
              closeOnClick: true,
              pauseOnHover: true,
            }
          );

          // Clear form fields after a short delay so user can see toast first
          setUserId('');
          setPassword('');
          setConfirmPassword('');
          setRole('user');
          setSelectedServices([]);
        }, 500); // Small delay before clearing form/redirecting
      }
    } catch (error) {
      setLoading(false); // Clear loading on error
      toast.error(error.response?.data?.error || 'Failed to create user. Please try again.', {
        icon: <AlertCircle className="text-state-danger" />,
        theme: "dark",
        className: "bg-surface border-line"
      });
      console.error('Error creating user:', error);
    }
  };

  return (
    // The form itself with all its styling
    <form onSubmit={handleSubmit} className="bg-surface shadow-card rounded-2xl max-w-md w-full p-6 space-y-6 md:p-8 transition-all duration-300 hover:shadow-lift border border-line">
      <h2 className="text-2xl font-bold text-center mb-6 text-ink0">Create User Account</h2>

      {/* Error Message for fetching services */}
      {fetchError && (
        <div className="flex items-center gap-2 text-state-danger bg-surface p-3 rounded-lg animate-fade-in border border-state-danger/30">
          <AlertCircle className="w-5 h-5" />
          {fetchError}
        </div>
      )}

      {/* User ID Input */}
      <div className="relative">
        <label htmlFor="userId" className="absolute left-3 top-3 text-sm text-ink-muted pointer-events-none transform -translate-y-2 scale-90 origin-left">
          User ID
        </label>
        <input
          id="userId"
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="w-full p-4 rounded-lg bg-surface border border-line focus:border-line focus:bg-surface text-ink placeholder:text-transparent"
          placeholder="Enter your user ID" // Placeholder is important for the floating label effect
          required
        />
      </div>

      {/* Password Inputs */}
      <div className="grid gap-4">
        <div className="relative">
          <label htmlFor="password" className="absolute left-3 top-3 text-sm text-ink-muted pointer-events-none transform -translate-y-2 scale-90 origin-left">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-4 rounded-lg bg-surface border border-line focus:border-line focus:bg-surface text-ink placeholder:text-transparent"
            placeholder="Enter your password"
            required
          />
        </div>
        <div className="relative">
          <label htmlFor="confirmPassword" className="absolute left-3 top-3 text-sm text-ink-muted pointer-events-none transform -translate-y-2 scale-90 origin-left">
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full p-4 rounded-lg bg-surface border border-line focus:border-line focus:bg-surface text-ink placeholder:text-transparent"
            placeholder="Confirm your password"
            required
          />
        </div>
      </div>

      {/* Role Selection */}
      <div className="relative">
        <label htmlFor="role" className="absolute left-3 top-3 text-sm text-ink-muted pointer-events-none transform -translate-y-2 scale-90 origin-left">
          Role
        </label>
        <select
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full p-4 rounded-lg bg-surface border border-line focus:border-line focus:bg-surface appearance-none cursor-pointer"
        >
          <option value="user">Regular User</option>
          <option value="admin">Administrator</option>
        </select>
        {/* Custom arrow for select input */}
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-ink-muted">
          <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
        </div>
      </div>

      {/* Services Selection */}
      <div>
        <label htmlFor="services" className="mb-3 block font-semibold text-ink-muted">
          Select Services:
        </label>
        <div
          id="services"
          className="space-y-2 bg-surface rounded-lg p-4 overflow-auto max-h-[150px] border border-line"
        >
          {servicesLoading ? (
            <div className="py-4 text-center text-ink0 animate-pulse">
              Loading available services...
            </div>
          ) : fetchError ? (
            <div className="py-4 text-center text-state-danger">
              <AlertCircle className="inline-block mr-2" />
              {fetchError}
            </div>
          ) : (
            services // Filter services to show only those with refill: true
              .map((service,index) => (
              <div key={index} className="flex items-center justify-between space-x-2 p-2 rounded hover:bg-surface-sunken cursor-pointer transition-colors">
                <label className="flex items-center space-x-2 flex-grow cursor-pointer">
                  <input
                    type="checkbox"
                    name="service"
                    value={service.serviceId}
                    checked={selectedServices.includes(service.serviceId)}
                    onChange={() => handleServiceChange(service.serviceId)}
                    className="form-checkbox text-ink0 border-line rounded focus:ring-brand-purple/40"
                  />
                  <span className="text-ink-soft">
                    {service.name} (ID: {service.serviceId})
                    {service.refill && ( // Conditionally render "Refill Available" text
                      <span className="ml-2 px-2 py-1 bg-green-700 text-green-100 text-xs font-semibold rounded-full">
                        Refill
                      </span>
                    )}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent checkbox from toggling
                    confirmDeleteService(service); // Pass the full service object
                  }}
                  className="p-1 rounded-full text-state-danger hover:bg-red-900/50 hover:text-state-danger transition-colors"
                  title={`Delete ${service.name}`}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        className="w-full py-3 px-4 rounded-xl bg-purple-900 text-white font-semibold text-lg uppercase tracking-wide shadow-md hover:bg-surface-sunken hover:shadow-lg active:scale-95 transition-all duration-200 ease-in-out border border-line disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={loading} // Disable button during submission
      >
        {loading ? 'Creating account...' : 'Create Account'}
      </button>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={isDeleteConfirmModalOpen}
        onClose={() => setIsDeleteConfirmModalOpen(false)}
        onConfirm={handleDeleteService}
        service={serviceToDelete}
      />
    </form>
  );
};

export default CreateUserForm;