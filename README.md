# SMM (Social Media Marketing) Platform 

A full-stack web application for managing social media marketing services, orders, and transactions. This platform provides both admin and user interfaces for managing SMM services, placing orders, and tracking transactions.

## 🚀 Features

### Admin Features
- **User Management**: Create and manage user accounts
- **Service Management**: Add, update, and delete SMM services
- **Balance Management**: Add balance to user accounts
- **Password Management**: Change user passwords
- **Dashboard**: View user statistics and manage operations

### User Features
- **Order Placement**: Place orders for SMM services
- **Transaction History**: View payment and transaction history
- **Order Tracking**: Track order status and progress
- **Refill Requests**: Request refills for existing orders
- **Profile Management**: Update personal information and password

## 🛠️ Tech Stack

### Backend
- **Node.js** with Express.js
- **MongoDB** with Mongoose ODM
- **JWT** for authentication
- **bcrypt** for password hashing
- **CORS** for cross-origin requests

### Frontend
- **React 19** with Vite
- **React Router** for navigation
- **Tailwind CSS** for styling
- **Axios** for API communication
- **React Toastify** for notifications
- **Lucide React** for icons

## 📋 Prerequisites

Before running this application, make sure you have the following installed:
- Node.js (v16 or higher)
- MongoDB (local or cloud instance)
- npm or yarn package manager

## 🔧 Installation & Setup

### 1. Clone the Repository
```bash
git clone <repository-url>
cd smm-project
```

### 2. Backend Setup
```bash
cd backend
npm install
```

### 3. Frontend Setup
```bash
cd frontend
npm install
```

### 4. Environment Configuration

Create a `.env` file in the `backend` directory with the following variables:

```env
# Database Configuration
MONGO_URI=mongodb://localhost:27017/smm-platform
# or your MongoDB Atlas connection string

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here

# External API Configuration (for SMM services)
API_URL=https://your-smm-provider-api.com
API_KEY=your-smm-provider-api-key
```

### 5. Database Setup

Make sure MongoDB is running and accessible. The application will automatically create the necessary collections when it first connects.

## 🚀 Running the Application

### Development Mode

1. **Start the Backend Server**
```bash
cd backend
npm run dev
```
The backend will run on `http://localhost:3000`

2. **Start the Frontend Development Server**
```bash
cd frontend
npm run dev
```
The frontend will run on `http://localhost:5173`

### Production Mode

1. **Build the Frontend**
```bash
cd frontend
npm run build
```

2. **Start the Backend**
```bash
cd backend
npm start
```

## 📁 Project Structure

```
smm-project/
├── backend/
│   ├── models/           # MongoDB schemas
│   │   ├── routes/           # API endpoints
│   │   │   ├── Admin/        # Admin-specific routes
│   │   │   ├── User/         # User-specific routes
│   │   │   └── common/       # Shared routes
│   │   ├── middlewares/      # Express middlewares
│   │   ├── utils/            # Utility functions
│   │   └── index.js          # Main server file
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── components/   # Reusable React components
│   │   │   ├── pages/        # Page components
│   │   │   ├── context/      # React context providers
│   │   │   ├── service/      # API service functions
│   │   │   └── assets/       # Static assets
│   │   └── public/           # Public assets
│   └── README.md
```

## 🔐 Authentication

The application uses JWT-based authentication with HTTP-only cookies for security. Users are categorized into two roles:

- **Admin**: Full access to all features including user management and service administration
- **User**: Access to order placement, transaction history, and personal profile management

## 📊 Database Models

### User
- `userId`: Unique user identifier
- `password`: Hashed password
- `money`: Account balance
- `role`: User role (admin/user)
- `services`: Array of available services

### Service
- `serviceId`: Unique service identifier
- `service`: Service name
- `internalName`: Internal service name
- `name`: Display name
- `rate`: Service rate
- `min`: Minimum order quantity
- `max`: Maximum order quantity
- `refill`: Refill availability

### Order
- `orderId`: Unique order identifier
- `lastStatus`: Current order status
- `quantity`: Order quantity
- `rate`: Order rate
- `service`: Service name
- `user`: User reference
- `refill`: Refill information
- `start_count`: Starting count

### Transaction
- `amount`: Transaction amount
- `orderId`: Associated order ID
- `date`: Transaction date
- `user`: User reference

## 🔧 API Endpoints

### Authentication
- `POST /login` - User login
- `GET /auth/me` - Get current user info

### Admin Routes
- `POST /createUser` - Create new user
- `GET /getServices` - Get all services
- `POST /createService` - Create new service
- `PUT /updateService` - Update service
- `GET /getCustomServices` - Get custom services
- `PUT /addBalance` - Add user balance
- `POST /changeUserPassword` - Change user password
- `POST /getUser` - Get user information
- `POST /addService` - Add service to user
- `POST /deleteService` - Delete service from user
- `POST /deleteCustomServices` - Delete custom service

### User Routes
- `GET /userServices` - Get user's available services
- `POST /placeOrder` - Place new order
- `GET /getOrders` - Get user's orders
- `GET /getTransactions` - Get user's transactions
- `PUT /changePassword` - Change user password
- `POST /requestRefill` - Request order refill
- `POST /requestRefillStatus` - Check refill status
- `POST /getOrderStatus` - Get order status

## 🐛 Troubleshooting

### Common Issues

1. **MongoDB Connection Error**
   - Ensure MongoDB is running
   - Check your `MONGO_URI` in the `.env` file
   - Verify network connectivity

2. **JWT Token Issues**
   - Check that `JWT_SECRET` is set in your `.env` file
   - Ensure cookies are enabled in your browser
   - Verify CORS settings for cross-origin requests

3. **Frontend API Connection**
   - Ensure the backend server is running on port 3000
   - Check that the API base URL is correctly configured
   - Verify CORS settings in the backend

4. **Build Errors**
   - Clear `node_modules` and reinstall dependencies
   - Check for version conflicts in `package.json`
   - Ensure all required environment variables are set

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License.

## 📞 Support

For support and questions, please open an issue in the repository or contact the development team.

---

**Note**: This is a Social Media Marketing platform. Make sure to comply with all relevant laws and regulations when using external SMM services and APIs.
