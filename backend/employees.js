const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../database/connection');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Get all employees
router.get('/', authenticateToken, requirePermission('employees_view'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM employees WHERE is_active = true ORDER BY name'
    );
    res.json({ employees: result.rows });
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת רשימת העובדים' });
  }
});

// Get employee by ID
router.get('/:id', authenticateToken, requirePermission('employees_view'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM employees WHERE id = $1 AND is_active = true',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'עובד לא נמצא' });
    }

    res.json({ employee: result.rows[0] });
  } catch (error) {
    console.error('Get employee error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת פרטי העובד' });
  }
});

// Create new employee
router.post('/', authenticateToken, requirePermission('employees_edit'), [
  body('name').notEmpty().withMessage('שם העובד חובה'),
  body('role').notEmpty().withMessage('תפקיד העובד חובה')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, role, category, phone, email } = req.body;

    const result = await pool.query(
      `INSERT INTO employees (name, role, category, phone, email, is_active) 
       VALUES ($1, $2, $3, $4, $5, true) 
       RETURNING *`,
      [name, role, category, phone, email]
    );

    res.status(201).json({
      message: 'עובד נוסף בהצלחה',
      employee: result.rows[0]
    });
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({ error: 'שגיאה בהוספת העובד' });
  }
});

// Update employee
router.put('/:id', authenticateToken, requirePermission('employees_edit'), [
  body('name').notEmpty().withMessage('שם העובד חובה'),
  body('role').notEmpty().withMessage('תפקיד העובד חובה')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { name, role, category, phone, email } = req.body;

    const result = await pool.query(
      `UPDATE employees 
       SET name = $1, role = $2, category = $3, phone = $4, email = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND is_active = true
       RETURNING *`,
      [name, role, category, phone, email, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'עובד לא נמצא' });
    }

    res.json({
      message: 'עובד עודכן בהצלחה',
      employee: result.rows[0]
    });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון העובד' });
  }
});

// Delete employee (soft delete)
router.delete('/:id', authenticateToken, requirePermission('employees_manage'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE employees SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'עובד לא נמצא' });
    }

    res.json({
      message: 'עובד נמחק בהצלחה',
      employee: result.rows[0]
    });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת העובד' });
  }
});

module.exports = router;

