# Shift Scheduler Backend API

Backend API for the Shift Scheduler Application built with Express.js and PostgreSQL.

## Features

- 🔐 **Authentication & Authorization** - JWT-based auth with role-based permissions
- 👥 **User Management** - Admin can manage users and permissions
- 👷 **Employee Management** - CRUD operations for employees
- 🚗 **Vehicle Management** - Track and manage police vehicles
- 📅 **Schedule Management** - Weekly shift scheduling and assignments
- 📋 **Work Planning** - Daily work plans and task management
- 📝 **Request System** - Employee requests with approval workflow

## Tech Stack

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **PostgreSQL** - Database
- **JWT** - Authentication
- **bcryptjs** - Password hashing
- **Helmet** - Security middleware
- **CORS** - Cross-origin resource sharing
- **Rate Limiting** - API protection

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up PostgreSQL database:**
   - Install PostgreSQL
   - Create database: `shift_scheduler`
   - Update connection details in `config/config.js`

3. **Create environment file:**
   ```bash
   cp .env.example .env
   ```
   Update the values in `.env` file.

4. **Run the server:**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### Users (Admin only)
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `PUT /api/users/:id/password` - Update user password
- `DELETE /api/users/:id` - Delete user

### Employees
- `GET /api/employees` - Get all employees
- `GET /api/employees/:id` - Get employee by ID
- `POST /api/employees` - Create new employee
- `PUT /api/employees/:id` - Update employee
- `DELETE /api/employees/:id` - Delete employee

### Vehicles
- `GET /api/vehicles` - Get all vehicles
- `GET /api/vehicles/:id` - Get vehicle by ID
- `POST /api/vehicles` - Create new vehicle
- `PUT /api/vehicles/:id` - Update vehicle
- `DELETE /api/vehicles/:id` - Delete vehicle

### Schedule
- `GET /api/schedule/week/:date` - Get weekly schedule
- `GET /api/schedule/:date/:shiftType` - Get specific shift
- `POST /api/schedule` - Create/update shift
- `POST /api/schedule/assign` - Assign employee to shift
- `DELETE /api/schedule/unassign` - Remove employee from shift

### Work Plans
- `GET /api/workplan/:date` - Get work plan for date
- `GET /api/workplan/week/:date` - Get weekly work plans
- `POST /api/workplan` - Create/update work plan
- `PUT /api/workplan/shift-tasks` - Update shift tasks
- `DELETE /api/workplan/:date` - Delete work plan

### Requests
- `GET /api/requests` - Get all requests
- `GET /api/requests/:id` - Get request by ID
- `POST /api/requests` - Create new request
- `PUT /api/requests/:id/approve` - Approve request
- `PUT /api/requests/:id/reject` - Reject request
- `DELETE /api/requests/:id` - Delete request

## Database Schema

### Users Table
- `id` - Primary key
- `username` - Unique username
- `password` - Hashed password
- `email` - Unique email
- `name` - Full name
- `role` - User role (admin/manager/user)
- `permissions` - Array of permissions
- `is_active` - Account status
- `created_at` - Creation timestamp
- `last_login` - Last login timestamp

### Employees Table
- `id` - Primary key
- `name` - Employee name
- `role` - Job role
- `category` - Employee category
- `phone` - Phone number
- `email` - Email address
- `is_active` - Employment status
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp

### Vehicles Table
- `id` - Primary key
- `license_plate` - Unique license plate
- `vehicle_type` - Type of vehicle
- `model` - Vehicle model
- `year` - Manufacturing year
- `status` - Vehicle status
- `last_inspection` - Last inspection date
- `next_inspection` - Next inspection date
- `notes` - Additional notes
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp

### Shifts Table
- `id` - Primary key
- `date` - Shift date
- `shift_type` - Type of shift (morning/afternoon/evening)
- `assignments` - JSON array of employee assignments
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp

### Work Plans Table
- `id` - Primary key
- `date` - Plan date (unique)
- `general_tasks` - Array of general tasks
- `shift_tasks` - JSON object of shift-specific tasks
- `notes` - Additional notes
- `start_time` - Work start time
- `end_time` - Work end time
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp

### Requests Table
- `id` - Primary key
- `employee_id` - Foreign key to employees
- `request_type` - Type of request
- `description` - Request description
- `status` - Request status (pending/approved/rejected)
- `requested_date` - Requested date
- `approved_by` - Foreign key to users
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp

## Security Features

- **JWT Authentication** - Secure token-based authentication
- **Password Hashing** - bcryptjs for password security
- **Rate Limiting** - Protection against brute force attacks
- **CORS** - Controlled cross-origin requests
- **Helmet** - Security headers
- **Input Validation** - Request validation and sanitization
- **Role-based Access** - Permission-based API access

## Default Users

The system comes with default users:

### Admin Users
- **Username:** `itaymalka8` | **Password:** `1990`
- **Username:** `admin` | **Password:** `admin123`

Both have full admin permissions.

## Environment Variables

```env
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=shift_scheduler
DB_USER=postgres
DB_PASSWORD=password

JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run database initialization
node database/init.js
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Update database connection details
3. Set secure JWT secret
4. Configure CORS for production domain
5. Run `npm start`

## License

MIT License - © 2024 Itay Malka

