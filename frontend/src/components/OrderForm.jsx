import React, { useState, useEffect } from 'react';
import axios from 'axios';

function OrderForm() {
  const [formData, setFormData] = useState({
    linkInput: '',
    serviceId: '',
    quantity: 1,
    notes: '',
    totalAmount: 0,
  });

  const [servicesData, setServicesData] = useState([]); // State to store fetched services
  const [loading, setLoading] = useState(true); // State for loading indicator
  const [error, setError] = useState(null); // State for error handling

  // Fetch services data on component mount
  useEffect(() => {
    const fetchServices = async () => {
      try {
        setLoading(true);
        // Simulate API call with a delay
        if(servicesData.length!==0){
          return;
        }

        const response = await axios.get('http://localhost:3000/userServices', { withCredentials: true });
         // Return mock data
         // Simulate 1 second network delay

        setServicesData(response.data.data);
        setError(null); // Clear any previous errors
      } catch (err) {
        console.error("Failed to fetch services:", err);
        setError("Failed to load services. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []); // Empty dependency array means this runs once on mount

  // Find the currently selected product's data using 'service' as the key
  const selectedProduct = servicesData.find(p => p.service === formData.serviceId);
  // Access min and max using 'min' and 'max' keys, parse to integer
  const minQuantity = selectedProduct ? parseInt(selectedProduct.min, 10) : 1;
  const maxQuantity = selectedProduct ? parseInt(selectedProduct.max, 10) : 100000; // Default max if no product selected

  // Effect to calculate total amount whenever product or quantity changes
  useEffect(() => {
    if (selectedProduct) {
      // Ensure rate is parsed as a number
      const rate = parseFloat(selectedProduct.rate);
      const calculatedTotal = formData.quantity * rate;
      setFormData(prevData => ({
        ...prevData,
        totalAmount: calculatedTotal,
      }));
    } else {
      setFormData(prevData => ({
        ...prevData,
        totalAmount: 0,
      }));
    }
  }, [formData.serviceId, formData.quantity, selectedProduct]);

  // Handle input changes
  const handleChange = (e) => {
    const { name, value } = e.target;

    setFormData((prevData) => {
      let newValue = value;
      if (name === 'quantity') {
        const numValue = parseInt(value, 10);
        // Ensure quantity stays within min/max bounds
        if (selectedProduct) {
          if (numValue < parseInt(selectedProduct.min, 10)) newValue = parseInt(selectedProduct.min, 10);
          else if (numValue > parseInt(selectedProduct.max, 10)) newValue = parseInt(selectedProduct.max, 10);
        } else {
          // If no product selected, apply general min/max (or no limits)
          if (numValue < 1) newValue = 1;
        }
      }
      return {
        ...prevData,
        [name]: newValue,
      };
    });
  };

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    // In a real application, you would send this data to a backend server.
    console.log('Order Submitted:', formData);
    console.log('Order submitted successfully!');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-purple-500"></div>
        <p className="ml-4 text-lg text-purple-300">Loading services...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-400 text-center p-4 bg-red-900 bg-opacity-50 rounded-lg">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 bg-opacity-70 backdrop-blur-sm p-8 rounded-xl shadow-2xl w-full max-w-md border border-purple-700 transition-all duration-500 ease-in-out transform hover:scale-[1.01]">
      <h2 className="text-3xl font-extrabold text-white mb-6 text-center">Place Your Order</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Link Input */}
        <div>
          <label htmlFor="linkInput" className="block text-purple-300 text-sm font-semibold mb-2">
            Link
          </label>
          <input
            type="url" // Use type="url" for better input validation for links
            id="linkInput"
            name="linkInput"
            value={formData.linkInput}
            onChange={handleChange}
            required
            className="w-full p-3 bg-gray-700 border border-purple-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all duration-300"
            placeholder="https://example.com/your-item"
          />
        </div>

        {/* Product Selection */}
        <div>
          <label htmlFor="serviceId" className="block text-purple-300 text-sm font-semibold mb-2">
            Select Product/Service
          </label>
          <select
            id="serviceId"
            name="serviceId"
            value={formData.serviceId}
            onChange={handleChange}
            required
            className="w-full p-3 bg-gray-700 border border-purple-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all duration-300 appearance-none pr-8"
            // Add a custom arrow for select box (Tailwind doesn't provide one directly)
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill='%23a78bfa' d='M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 6.757 7.586 5.343 9z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1.2rem' }}
          >
            <option value="" disabled>Choose a product or service</option>
            {servicesData.map(product => (
              <option key={product.service} value={product.service}>
                {product.name} (Rate: ${parseFloat(product.rate).toFixed(2)}/unit)
              </option>
            ))}
          </select>
        </div>

        {/* Display Service ID, Link to Page, and Quantity Needed */}
        {selectedProduct && (
          <div className="bg-gray-700 p-4 rounded-lg border border-purple-600 space-y-2 transition-all duration-300 ease-in-out">
            <h3 className="text-purple-300 text-base font-semibold mb-2">Selected Service Details:</h3>
            <div className="flex justify-between items-center">
              <span className="text-purple-300 text-sm">Service ID:</span>
              <span className="text-white text-sm font-medium">{selectedProduct.name}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-purple-300 text-sm">Quantity Needed:</span>
              <span className="text-white text-sm font-medium">{formData.quantity}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-purple-300 text-sm">Cost:</span>
              <span className="text-white text-sm font-medium">{selectedProduct.rate}</span>
            </div>
          </div>
        )}

        {/* Quantity Input */}
        <div>
          <label htmlFor="quantity" className="block text-purple-300 text-sm font-semibold mb-2">
            Quantity
          </label>
          {/* Display min/max below the quantity input */}
          {selectedProduct && (
            <p className="text-purple-400 text-xs mb-1">
              Min: {minQuantity}, Max: {maxQuantity}
            </p>
          )}
          <input
            type="number"
            id="quantity"
            name="quantity"
            value={formData.quantity}
            onChange={handleChange}
            min={minQuantity} // Dynamically set min based on selected product
            max={maxQuantity} // Dynamically set max based on selected product
            required
            className="w-full p-3 bg-gray-700 border border-purple-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all duration-300"
            disabled={!formData.serviceId} // Disable quantity input if no product is selected
          />
        </div>

        {/* Total Amount Display */}
        <div className="flex justify-between items-center bg-gray-700 p-4 rounded-lg border border-purple-600">
          <span className="text-purple-300 text-lg font-semibold">Total Amount:</span>
          <span className="text-white text-2xl font-bold">
            ${formData.totalAmount.toFixed(2)}
          </span>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-lg shadow-lg transition-all duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-gray-800"
        >
          Submit Order
        </button>
      </form>
    </div>
  );
}
export default OrderForm;