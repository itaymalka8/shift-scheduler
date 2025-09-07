const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../database/connection');
const config = require('../config/config');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Register new user
router.post('/register', [
  body('username').isLength({ min: 3 }).withMessage('שם משתמש חייב להכיל לפחות 3 תווים'),
  body('password').isLength({ min: 1 }).withMessage('סיסמה חובה'),
  body('email').isEmail().withMessage('כתובת מייל לא תקינה'),
  body('name').isLength({ min: 2 }).withMessage('שם חייב להכיל לפחות 2 תווים')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password, email, name } = req.body;

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'שם משתמש או מייל כבר קיימים' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user
    const result = await pool.query(
      `INSERT INTO users (username, password, email, name, role, permissions, is_active) 
       VALUES ($1, $2, $3, $4, 'user', $5, true) 
       RETURNING id, username, email, name, role, permissions, is_active, created_at`,
      [
        username, 
        hashedPassword, 
        email, 
        name,
        ['schedule_view', 'employees_view', 'vehicles_view', 'requests_view', 'workplan_view']
      ]
    );

    const user = result.rows[0];
    delete user.password;

    res.status(201).json({
      message: 'משתמש נוצר בהצלחה',
      user
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת המשתמש' });
  }
});

// Login
router.post('/login', [
  body('username').notEmpty().withMessage('שם משתמש חובה'),
  body('password').notEmpty().withMessage('סיסמה חובה')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    // Get user from database
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    }

    const user = result.rows[0];

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      config.JWT.SECRET,
      { expiresIn: config.JWT.EXPIRES_IN }
    );

    // Remove password from response
    delete user.password;

    res.json({
      message: 'התחברות הצליחה',
      token,
      user
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'שגיאה בהתחברות' });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    res.json({
      user: req.user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת פרטי המשתמש' });
  }
});

// Logout (client-side token removal)
router.post('/logout', authenticateToken, (req, res) => {
  res.json({ message: 'התנתקות הצליחה' });
});

module.exports = router;

