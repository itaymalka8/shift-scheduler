const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const pool = require('../database/connection');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get all users (admin only)
router.get('/', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, name, role, permissions, is_active, created_at, last_login FROM users ORDER BY created_at DESC'
    );
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת רשימת המשתמשים' });
  }
});

// Get user by ID
router.get('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, username, email, name, role, permissions, is_active, created_at, last_login FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת פרטי המשתמש' });
  }
});

// Create new user (admin only)
router.post('/', authenticateToken, requireRole('admin'), [
  body('username').isLength({ min: 3 }).withMessage('שם משתמש חייב להכיל לפחות 3 תווים'),
  body('password').isLength({ min: 1 }).withMessage('סיסמה חובה'),
  body('email').isEmail().withMessage('כתובת מייל לא תקינה'),
  body('name').isLength({ min: 2 }).withMessage('שם חייב להכיל לפחות 2 תווים'),
  body('role').isIn(['admin', 'manager', 'user']).withMessage('תפקיד לא תקין')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password, email, name, role, permissions } = req.body;

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
       VALUES ($1, $2, $3, $4, $5, $6, true) 
       RETURNING id, username, email, name, role, permissions, is_active, created_at`,
      [username, hashedPassword, email, name, role, permissions || []]
    );

    res.status(201).json({
      message: 'משתמש נוצר בהצלחה',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת המשתמש' });
  }
});

// Update user (admin only)
router.put('/:id', authenticateToken, requireRole('admin'), [
  body('username').isLength({ min: 3 }).withMessage('שם משתמש חייב להכיל לפחות 3 תווים'),
  body('email').isEmail().withMessage('כתובת מייל לא תקינה'),
  body('name').isLength({ min: 2 }).withMessage('שם חייב להכיל לפחות 2 תווים'),
  body('role').isIn(['admin', 'manager', 'user']).withMessage('תפקיד לא תקין')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { username, email, name, role, permissions, is_active } = req.body;

    // Check if username or email already exists for other users
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE (username = $1 OR email = $2) AND id != $3',
      [username, email, id]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'שם משתמש או מייל כבר קיימים' });
    }

    const result = await pool.query(
      `UPDATE users 
       SET username = $1, email = $2, name = $3, role = $4, permissions = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id, username, email, name, role, permissions, is_active, created_at, last_login`,
      [username, email, name, role, permissions, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }

    res.json({
      message: 'משתמש עודכן בהצלחה',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון המשתמש' });
  }
});

// Update user password (admin only)
router.put('/:id/password', authenticateToken, requireRole('admin'), [
  body('password').isLength({ min: 1 }).withMessage('סיסמה חובה')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { password } = req.body;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id',
      [hashedPassword, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }

    res.json({
      message: 'סיסמה עודכנה בהצלחה'
    });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון הסיסמה' });
  }
});

// Delete user (admin only)
router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Don't allow deleting yourself
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'לא ניתן למחוק את עצמך' });
    }

    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, username', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'משתמש לא נמצא' });
    }

    res.json({
      message: 'משתמש נמחק בהצלחה',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת המשתמש' });
  }
});

module.exports = router;

