const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  console.log('📥 GET / request received');
  res.json({ 
    message: 'Shift Scheduler Backend is running!',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

app.get('/api/health', (req, res) => {
  console.log('📥 GET /api/health request received');
  res.json({ 
    status: 'OK', 
    message: 'Backend is healthy',
    port: PORT
  });
});

app.get('/api/test', (req, res) => {
  console.log('📥 GET /api/test request received');
  res.json({ 
    message: 'Test endpoint working!',
    environment: process.env.NODE_ENV || 'development',
    port: PORT
  });
});

// Start server with error handling
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Backend is ready!`);
}).on('error', (err) => {
  console.error('❌ Server error:', err);
});
