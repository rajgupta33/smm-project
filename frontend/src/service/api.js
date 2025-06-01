// Replace with your API base URL
const API_BASE_URL = 'https://backend-6qxr.onrender.com';

// Helper for handling API responses
const handleResponse = async (response) => {
  const data = await response.json();
  
  if (response.status!==200) {
    throw new Error(data.message || 'Something went wrong');
  }
  
  return data;
};

// Authentication APIs
export const authApi = {
  login: async (credentials) => {
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });
    
    return handleResponse(response);
  },
}