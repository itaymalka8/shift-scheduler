const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../database/connection');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Get all requests
router.get('/', authenticateToken, requirePermission('requests_view'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, e.name as employee_name 
       FROM requests r 
       JOIN employees e ON r.employee_id = e.id 
       ORDER BY r.created_at DESC`
    );
    res.json({ requests: result.rows });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת רשימת הבקשות' });
  }
});

// Get request by ID
router.get('/:id', authenticateToken, requirePermission('requests_view'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT r.*, e.name as employee_name 
       FROM requests r 
       JOIN employees e ON r.employee_id = e.id 
       WHERE r.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'בקשה לא נמצאה' });
    }

    res.json({ request: result.rows[0] });
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת פרטי הבקשה' });
  }
});

// Create new request
router.post('/', authenticateToken, [
  body('employee_id').isInt().withMessage('מזהה עובד לא תקין'),
  body('request_type').notEmpty().withMessage('סוג בקשה חובה'),
  body('description').notEmpty().withMessage('תיאור הבקשה חובה')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { employee_id, request_type, description, requested_date } = req.body;

    const result = await pool.query(
      `INSERT INTO requests (employee_id, request_type, description, requested_date, status) 
       VALUES ($1, $2, $3, $4, 'pending') 
       RETURNING *`,
      [employee_id, request_type, description, requested_date]
    );

    res.status(201).json({
      message: 'בקשה נוצרה בהצלחה',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('Create request error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת הבקשה' });
  }
});

// Approve request
router.put('/:id/approve', authenticateToken, requirePermission('requests_approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { approved_by } = req.body;

    const result = await pool.query(
      `UPDATE requests 
       SET status = 'approved', approved_by = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [approved_by, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'בקשה לא נמצאה' });
    }

    res.json({
      message: 'בקשה אושרה בהצלחה',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('Approve request error:', error);
    res.status(500).json({ error: 'שגיאה באישור הבקשה' });
  }
});

// Reject request
router.put('/:id/reject', authenticateToken, requirePermission('requests_approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { approved_by } = req.body;

    const result = await pool.query(
      `UPDATE requests 
       SET status = 'rejected', approved_by = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [approved_by, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'בקשה לא נמצאה' });
    }

    res.json({
      message: 'בקשה נדחתה בהצלחה',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('Reject request error:', error);
    res.status(500).json({ error: 'שגיאה בדחיית הבקשה' });
  }
});

// Delete request
router.delete('/:id', authenticateToken, requirePermission('requests_manage'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM requests WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'בקשה לא נמצאה' });
    }

    res.json({
      message: 'בקשה נמחקה בהצלחה',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('Delete request error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת הבקשה' });
  }
});

module.exports = router;

