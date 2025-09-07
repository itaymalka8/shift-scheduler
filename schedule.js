const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../database/connection');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Get schedule for a specific week
router.get('/week/:date', authenticateToken, requirePermission('schedule_view'), async (req, res) => {
  try {
    const { date } = req.params;
    const startDate = new Date(date);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    const result = await pool.query(
      'SELECT * FROM shifts WHERE date BETWEEN $1 AND $2 ORDER BY date, shift_type',
      [startDate, endDate]
    );

    res.json({ shifts: result.rows });
  } catch (error) {
    console.error('Get schedule error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת הסידור' });
  }
});

// Get shift by date and type
router.get('/:date/:shiftType', authenticateToken, requirePermission('schedule_view'), async (req, res) => {
  try {
    const { date, shiftType } = req.params;

    const result = await pool.query(
      'SELECT * FROM shifts WHERE date = $1 AND shift_type = $2',
      [date, shiftType]
    );

    if (result.rows.length === 0) {
      return res.json({ shift: null });
    }

    res.json({ shift: result.rows[0] });
  } catch (error) {
    console.error('Get shift error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת המשמרת' });
  }
});

// Create or update shift
router.post('/', authenticateToken, requirePermission('schedule_edit'), [
  body('date').isISO8601().withMessage('תאריך לא תקין'),
  body('shift_type').notEmpty().withMessage('סוג משמרת חובה'),
  body('assignments').isArray().withMessage('שיבוצים חייבים להיות מערך')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { date, shift_type, assignments } = req.body;

    const result = await pool.query(
      `INSERT INTO shifts (date, shift_type, assignments) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (date, shift_type) 
       DO UPDATE SET assignments = $3, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [date, shift_type, JSON.stringify(assignments)]
    );

    res.json({
      message: 'משמרת נשמרה בהצלחה',
      shift: result.rows[0]
    });
  } catch (error) {
    console.error('Save shift error:', error);
    res.status(500).json({ error: 'שגיאה בשמירת המשמרת' });
  }
});

// Assign employee to shift
router.post('/assign', authenticateToken, requirePermission('schedule_edit'), [
  body('date').isISO8601().withMessage('תאריך לא תקין'),
  body('shift_type').notEmpty().withMessage('סוג משמרת חובה'),
  body('employee_id').isInt().withMessage('מזהה עובד לא תקין')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { date, shift_type, employee_id, status, note, tasks } = req.body;

    // Get existing shift
    const existingShift = await pool.query(
      'SELECT * FROM shifts WHERE date = $1 AND shift_type = $2',
      [date, shift_type]
    );

    let assignments = [];
    if (existingShift.rows.length > 0) {
      assignments = existingShift.rows[0].assignments || [];
    }

    // Remove existing assignment for this employee
    assignments = assignments.filter(assignment => assignment.employeeId !== employee_id);

    // Add new assignment
    assignments.push({
      employeeId: employee_id,
      status: status || undefined,
      note: note || undefined,
      tasks: tasks || []
    });

    const result = await pool.query(
      `INSERT INTO shifts (date, shift_type, assignments) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (date, shift_type) 
       DO UPDATE SET assignments = $3, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [date, shift_type, JSON.stringify(assignments)]
    );

    res.json({
      message: 'עובד שובץ בהצלחה',
      shift: result.rows[0]
    });
  } catch (error) {
    console.error('Assign employee error:', error);
    res.status(500).json({ error: 'שגיאה בשיבוץ העובד' });
  }
});

// Remove employee from shift
router.delete('/unassign', authenticateToken, requirePermission('schedule_edit'), [
  body('date').isISO8601().withMessage('תאריך לא תקין'),
  body('shift_type').notEmpty().withMessage('סוג משמרת חובה'),
  body('employee_id').isInt().withMessage('מזהה עובד לא תקין')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { date, shift_type, employee_id } = req.body;

    const existingShift = await pool.query(
      'SELECT * FROM shifts WHERE date = $1 AND shift_type = $2',
      [date, shift_type]
    );

    if (existingShift.rows.length === 0) {
      return res.status(404).json({ error: 'משמרת לא נמצאה' });
    }

    let assignments = existingShift.rows[0].assignments || [];
    assignments = assignments.filter(assignment => assignment.employeeId !== employee_id);

    const result = await pool.query(
      'UPDATE shifts SET assignments = $1, updated_at = CURRENT_TIMESTAMP WHERE date = $2 AND shift_type = $3 RETURNING *',
      [JSON.stringify(assignments), date, shift_type]
    );

    res.json({
      message: 'עובד הוסר מהמשמרת בהצלחה',
      shift: result.rows[0]
    });
  } catch (error) {
    console.error('Unassign employee error:', error);
    res.status(500).json({ error: 'שגיאה בהסרת העובד מהמשמרת' });
  }
});

module.exports = router;

