import axiosLibrary from 'axios'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const axios = axiosLibrary.create({ withCredentials: true });
let csrfToken;
let csrfPromise;

async function refreshCsrfToken() {
  if (!csrfPromise) {
    csrfPromise = axiosLibrary.get(`${API_BASE_URL}/auth/csrf`, { withCredentials: true })
      .then((response) => {
        csrfToken = response.data.csrfToken;
        return csrfToken;
      })
      .finally(() => { csrfPromise = null; });
  }
  return csrfPromise;
}

axios.interceptors.request.use(async (config) => {
  const method = (config.method || 'get').toLowerCase();
  if (!['get', 'head', 'options'].includes(method)) {
    config.headers['X-CSRF-Token'] = csrfToken || await refreshCsrfToken();
  }
  return config;
});

axios.interceptors.response.use(undefined, async (error) => {
  if (error.response?.data?.code === 'CSRF_INVALID' && !error.config?._csrfRetried) {
    error.config._csrfRetried = true;
    error.config.headers['X-CSRF-Token'] = await refreshCsrfToken();
    return axios(error.config);
  }
  throw error;
});


export const authApi = {
  login: async ({ userId, password }) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/auth/login`,
        { userId, password },
        { withCredentials: true }
      );
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, message: response.data.message || "Login failed" };
      }
    } catch (error) {
      console.error('API Error (login):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },
  me: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/auth/me`, { withCredentials: true });
      if (response.status === 200) {
        const { userId, role, wallet } = response.data;
        return {
          success: true,
          data: {
            isAuthenticated: true,
            user: { id: userId, role, wallet }
          }
        };
      } else {
        return {
          success: false,
          data: {
            isAuthenticated: false,
            user: { id: '', role: '', wallet: 0 }
          }
        };
      }
    } catch {
      return {
        success: false,
        data: {
          isAuthenticated: false,
          user: { id: '', role: '', wallet: 0 }
        }
      };
    }
  },
  logout: async () => {
    try {
      const response = await axios.post(`${API_BASE_URL}/auth/logout`, {}, { withCredentials: true });
      if (response.status === 200) {
        return { success: true, message: response.data.message };
      } else {
        return { success: false, message: response.data.message || "Logout failed" };
      }
    } catch (error) {
      console.error('API Error (logout):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },
};

export const paymentApi = {
  config: async () => (await axios.get(`${API_BASE_URL}/payments/config`)).data.data,
  createOrder: async (amount, idempotencyKey) => (
    await axios.post(`${API_BASE_URL}/payments/cashfree/order`, { amount }, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
  ).data,
  listMine: async (page = 1, limit = 20) => (
    await axios.get(`${API_BASE_URL}/payments/orders`, { params: { page, limit } })
  ).data,
  getMine: async (merchantOrderId) => (
    await axios.get(`${API_BASE_URL}/payments/orders/${encodeURIComponent(merchantOrderId)}`)
  ).data.data,
  listAdmin: async ({ page = 1, limit = 50, status = '' } = {}) => (
    await axios.get(`${API_BASE_URL}/admin/payments`, { params: { page, limit, status: status || undefined } })
  ).data,
  reconcile: async (paymentId) => (
    await axios.post(`${API_BASE_URL}/admin/payments/${encodeURIComponent(paymentId)}/reconcile`, {})
  ).data.data,
};

export const refillApi = {
  listAdmin: async (status = '') => (
    await axios.get(`${API_BASE_URL}/admin/refills`, { params: { status: status || undefined } })
  ).data.data,
  pollAdmin: async (refillRequestId) => (
    await axios.post(`${API_BASE_URL}/admin/refills/${encodeURIComponent(refillRequestId)}/poll`, {})
  ).data.data,
};

export const ticketApi = {
  create: async (data, idempotencyKey) => (
    await axios.post(`${API_BASE_URL}/user/tickets`, data, { headers: { 'Idempotency-Key': idempotencyKey } })
  ).data,
  listMine: async () => (await axios.get(`${API_BASE_URL}/user/tickets`)).data.data,
  getMine: async (publicTicketId) => (
    await axios.get(`${API_BASE_URL}/user/tickets/${encodeURIComponent(publicTicketId)}`)
  ).data.data,
  reply: async (publicTicketId, message, idempotencyKey) => (
    await axios.post(`${API_BASE_URL}/user/tickets/${encodeURIComponent(publicTicketId)}/messages`,
      { message }, { headers: { 'Idempotency-Key': idempotencyKey } })
  ).data,
  listAdmin: async (status = '') => (
    await axios.get(`${API_BASE_URL}/admin/tickets`, { params: { status: status || undefined } })
  ).data.data,
  getAdmin: async (publicTicketId) => (
    await axios.get(`${API_BASE_URL}/admin/tickets/${encodeURIComponent(publicTicketId)}`)
  ).data.data,
  adminReply: async (publicTicketId, { message, internalOnly }, idempotencyKey) => (
    await axios.post(`${API_BASE_URL}/admin/tickets/${encodeURIComponent(publicTicketId)}/messages`,
      { message, internalOnly }, { headers: { 'Idempotency-Key': idempotencyKey } })
  ).data,
  updateAdmin: async (publicTicketId, data, idempotencyKey) => (
    await axios.patch(`${API_BASE_URL}/admin/tickets/${encodeURIComponent(publicTicketId)}`,
      data, { headers: { 'Idempotency-Key': idempotencyKey } })
  ).data,
};

export const analyticsApi = {
  overview: async () => (
    await axios.get(`${API_BASE_URL}/admin/analytics/overview`)
  ).data.data,
};

export const operationsApi = {
  listReconciliationOrders: async () => (
    await axios.get(`${API_BASE_URL}/admin/operations/reconciliationOrders`, { params: { limit: 100 } })
  ).data.data,
  resolveReconciliation: async (orderId, data) => (
    await axios.post(
      `${API_BASE_URL}/admin/operations/reconciliationOrders/${encodeURIComponent(orderId)}/resolve`,
      data,
      { headers: { 'X-Request-Id': crypto.randomUUID() } },
    )
  ).data,
};

export const manualTaskApi = {
  list: async (status = '') => (
    await axios.get(`${API_BASE_URL}/admin/manualTasks`, {
      params: { status: status || undefined },
    })
  ).data,
  claim: async (taskId) => (
    await axios.post(`${API_BASE_URL}/admin/manualTasks/${encodeURIComponent(taskId)}/assign`, {})
  ).data.task,
  update: async (taskId, data) => (
    await axios.put(`${API_BASE_URL}/admin/manualTasks/${encodeURIComponent(taskId)}`, data)
  ).data.task,
};

export const providerApi = {
  listProviders: async () => (
    await axios.get(`${API_BASE_URL}/admin/providers`)
  ).data.data,
  createProvider: async (data) => (
    await axios.post(`${API_BASE_URL}/admin/providers`, data)
  ).data.data,
  updateProvider: async (providerId, data) => (
    await axios.patch(`${API_BASE_URL}/admin/providers/${encodeURIComponent(providerId)}`, data)
  ).data.data,
  listCatalogue: async () => (
    await axios.get(`${API_BASE_URL}/admin/catalogueServices`, { params: { limit: 200 } })
  ).data.data,
  listOffers: async () => (
    await axios.get(`${API_BASE_URL}/admin/providerOffers`, { params: { limit: 200 } })
  ).data.data,
  updateRouting: async (catalogueServiceId, data) => (
    await axios.put(`${API_BASE_URL}/admin/catalogueServices/${encodeURIComponent(catalogueServiceId)}`, data)
  ).data.data,
  queueSyncReport: async (providerId) => (
    await axios.post(`${API_BASE_URL}/admin/providerSync/report`, { providerId }, {
      headers: { 'X-Request-Id': crypto.randomUUID() },
    })
  ).data.data,
  listSyncRuns: async () => (
    await axios.get(`${API_BASE_URL}/admin/providerSync/runs`, { params: { limit: 25 } })
  ).data.data,
  getSyncRun: async (runId) => (
    await axios.get(`${API_BASE_URL}/admin/providerSync/runs/${encodeURIComponent(runId)}`)
  ).data.data,
  applySyncRun: async (runId, catalogueMappings) => (
    await axios.post(`${API_BASE_URL}/admin/providerSync/runs/${encodeURIComponent(runId)}/apply`,
      { catalogueMappings }, { headers: { 'X-Request-Id': crypto.randomUUID() } })
  ).data,
};

export const serviceApi = {
  getOrderTimeline: async (orderId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/user/orders/${orderId}`, { withCredentials: true });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, message: error.response?.data?.error || error.message };
    }
  },

  getPricingSettings: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/pricingSettings`, { withCredentials: true });
      return { success: true, data: response.data.data };
    } catch (error) {
      return { success: false, message: error.response?.data?.error || error.message };
    }
  },

  updatePricingSettings: async (data) => {
    try {
      const response = await axios.put(`${API_BASE_URL}/admin/pricingSettings`, data, { withCredentials: true });
      return { success: true, data: response.data.data };
    } catch (error) {
      return { success: false, message: error.response?.data?.error || error.message };
    }
  },

  previewPricing: async (providerRate, markupBps) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/pricingSettings/preview`,
        { providerRate, markupBps },
        { withCredentials: true }
      );
      return { success: true, data: response.data.data };
    } catch (error) {
      return { success: false, message: error.response?.data?.error || error.message };
    }
  },

  getPricingHistory: async (limit = 10) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/pricingSettings/history`, {
        params: { limit },
        withCredentials: true,
      });
      return { success: true, data: response.data.data };
    } catch (error) {
      return { success: false, message: error.response?.data?.error || error.message };
    }
  },

  getServices: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/getServices`, { withCredentials: true });
      if (response.status === 200) {
        return { success: true, data: response.data.data};
      } else {
        return { success: false, message: response.data.message || "Failed to load services" };
      }
    } catch (error) {
      console.error('API Error (getServices):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  createService: async (serviceData) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/admin/createService`, serviceData, { withCredentials: true });
      if (response.status === 200) {
        return { success: true, data: response.data};
      } else {
        return { success: false, message: response.data.message || "Failed to create service" };
      }
    } catch (error) {
      console.error('API Error (createService):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  updateService: async (serviceData) => {
    try {
      const response = await axios.put(`${API_BASE_URL}/admin/updateService`, serviceData, { withCredentials: true });
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, message: response.data.message || "Failed to update service" };
      }
    } catch (error) {
      console.error('API Error (updateService):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  customServices: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/getCustomServices`, { withCredentials: true });
      
      if (response.status >= 200 && response.status < 300) {
        return { success: true, data: response.data.data };
      } else {
        return { success: false, message: response.data.message || "Failed to load custom services" };
      }
    } catch (error) {
      console.error('API Error (customServices):', error);
      return { success: false, message: error.response?.data?.error || error.response?.data?.message || error.message };
    }
  },

  changePassword: async (data) => {
    try {
      const response = await axios.put(`${API_BASE_URL}/user/changePassword`, data, { withCredentials: true });
      
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, message: response.data.message || "Failed to change password" };
      }
    } catch (error) {
      console.error('API Error (changePassword):', error);
      return { success: false, message: error.response?.data?.error || error.response?.data?.message || error.message };
    }
  },

  addBalance: async (data, idempotencyKey) => {
    try {
      const response = await axios.put(`${API_BASE_URL}/admin/addBalance`, data, {
        withCredentials: true,
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      
      if (response.status === 200) {
        return { success: true, data: response.data.data };
      } else {
        return { success: false, message: response.data.message || "Failed to load custom services" };
      }
    } catch (error) {
      console.error('API Error (customServices):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  changeUserPassword: async(data) => {
    try {

      const response = await axios.post(`${API_BASE_URL}/admin/changeUserPassword`, data, { withCredentials: true });

      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        console.log(response);
        return { success: false, message: response.data.message || "Failed to load custom services" };
      }
    } catch (error) {
      console.error('API Error (customServices):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  createUser: async(data) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/admin/createUser`, data, { withCredentials: true });
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, message: response.data.message || "Failed to create user" };
      }
    } catch (error) {
      console.error('API Error (createUser):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  getUserServices: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/user/userServices`, { withCredentials: true });
      if (response.status === 200) {
        return { success: true, data: response.data.data };
      } else {
        return { success: false, message: response.data.message || "Failed to load user services" };
      }
    } catch (error) {
      console.error('API Error (getUserServices):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  quoteOrder: async (orderData, { signal } = {}) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/user/orders/quote`, orderData, {
        withCredentials: true,
        signal,
      });
      return { success: true, data: response.data.data };
    } catch (error) {
      if (axiosLibrary.isCancel?.(error) || error.name === 'CanceledError') {
        return { success: false, canceled: true };
      }
      return {
        success: false,
        message: error.response?.data?.message || error.message,
        code: error.response?.data?.code,
      };
    }
  },

  placeOrder: async (orderData, idempotencyKey) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/user/placeOrder`, orderData, {
        withCredentials: true,
        headers: { 'Idempotency-Key': idempotencyKey },
        // Without this, a request that never gets a response (a dropped
        // connection, a cold-starting dependency) leaves the caller's UI
        // waiting forever with nothing to show the customer. The
        // Idempotency-Key means retrying — or just checking the Orders page
        // — is always safe, so a client-side timeout can fail loudly here
        // without risking a duplicate order.
        timeout: 30000,
      });
      return { success: true, data: response.data };
    } catch (error) {
      console.error('API Error (placeOrder):', error);
      const timedOut = error.code === 'ECONNABORTED';
      return {
        success: false,
        message: timedOut
          ? 'This is taking longer than expected. Check your Orders page before submitting again — the order may have already gone through.'
          : (error.response?.data?.error || error.response?.data?.msg || error.message),
        data: error.response?.data,
        timedOut,
      };
    }
  },

  getTransactions: async(page,limit) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/user/getTransactions`, {
        params: { page, limit },
        withCredentials: true
      });
      if (response.status === 200) {
        return { success: true, data: response.data.data};
      } else {
        return { success: false, message: response.data.message || "Failed to load transactions" };
      }
    } catch (error) {
      console.error('API Error (getTransactions):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  getOrders: async (page,limit) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/user/getOrders`, {
        params: { page, limit },
        withCredentials: true
      });
      if (response.status === 200) {
        return { success: true, data: response.data.data };
      } else {
        return { success: false, message: response.data.message || "Failed to load orders" };
      }
    } catch (error) {
      console.error('API Error (getOrders):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  getUser: async (userId) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/getUser`,
        { userId },
        { withCredentials: true }
      );
      if (response.status === 200) {
        return { success: true, data: response.data};
      } else {
        return { success: false, message: response.data.message || "Failed to load user" };
      }
    } catch (error) {
      console.error('API Error (getUser):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  addService: async ({userId, serviceId}) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/addService`,
        { userId, serviceId },
        { withCredentials: true }
      );
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, message: response.data.message || "Failed to add service" };
      }
    } catch (error) {
      console.error('API Error (addService):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  deleteService: async ({userId, serviceId}) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/deleteService`,
        { userId, serviceId },
        { withCredentials: true }
      );
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, message: response.data.message || "Failed to delete service" };
      }
    } catch (error) {
      console.error('API Error (deleteService):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  deleteCustomServices: async ({serviceId }) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/deleteCustomServices`,
        { serviceId },
        { withCredentials: true }
      );
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, message: response.data.message || "Failed to delete custom service" };
      }
    } catch (error) {
      console.error('API Error (deleteCustomServices):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },

  requestRefill: async (orderId) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/user/requestRefill`,
        { orderId },
        {
          withCredentials: true,
          headers: {
            'Idempotency-Key': globalThis.crypto?.randomUUID?.()
              || `refill-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          },
        }
      );
      if (response.status >= 200 && response.status < 300) {
        return { success: true, data: response.data.data };
      } else {
        return { success: false, message: response.data.message || "Failed to request refill" };
      }
    } catch (error) {
      console.error('API Error (requestRefill):', error);
      return { success: false, message: error.response?.data?.error || error.response?.data?.message || error.message };
    }
  },

  checkRefillStatus: async (refillRequestId) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/user/requestRefillStatus`,
        { refillRequestId },
        { withCredentials: true }
      );
      if (response.status === 200) {
        return { success: true, data: response.data.data };
      } else {
        return { success: false, message: response.data.message || "Failed to get refill status" };
      }
    } catch (error) {
      console.error('API Error (requestRefillStatus):', error);
      return { success: false, message: error.response?.data?.error || error.response?.data?.message || error.message };
    }
  },

  checkOrderStatus: async (order) =>{
    try {
      const response = await axios.post(
        `${API_BASE_URL}/user/getOrderStatus`,
        { order },
        { withCredentials: true }
      );
      if (response.status === 200) {
        return { success: true, data: response.data };
      } else {
        return { success: false, message: response.data.message || "Failed to get order status" };
      }
    } catch (error) {
      console.error('API Error (getOrderStatus):', error);
      return { success: false, message: error.response?.data?.message || error.message };
    }
  },
};
