const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Initialize database
const initializeDatabase = require('./database/init');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const employeesRoutes = require('./routes/employees');
const vehiclesRoutes = require('./routes/vehicles');
const scheduleRoutes = require('./routes/schedule');
const workPlanRoutes = require('./routes/workPlan');
const requestsRoutes = require('./routes/requests');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'יותר מדי בקשות מהכתובת הזו, נסה שוב מאוחר יותר'
});
app.use(limiter);

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/workplan', workPlanRoutes);
app.use('/api/requests', requestsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    message: 'Shift Scheduler Backend API is running'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'שגיאה פנימית בשרת',
    message: process.env.NODE_ENV === 'development' ? err.message : 'שגיאה פנימית'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'הנתיב לא נמצא' });
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
  
  // Initialize database
  await initializeDatabase();
});
