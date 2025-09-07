const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../database/connection');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Get work plan for a specific date
router.get('/:date', authenticateToken, requirePermission('workplan_view'), async (req, res) => {
  try {
    const { date } = req.params;

    const result = await pool.query(
      'SELECT * FROM work_plans WHERE date = $1',
      [date]
    );

    if (result.rows.length === 0) {
      return res.json({ workPlan: null });
    }

    res.json({ workPlan: result.rows[0] });
  } catch (error) {
    console.error('Get work plan error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת תכנון העבודה' });
  }
});

// Get work plans for a week
router.get('/week/:date', authenticateToken, requirePermission('workplan_view'), async (req, res) => {
  try {
    const { date } = req.params;
    const startDate = new Date(date);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    const result = await pool.query(
      'SELECT * FROM work_plans WHERE date BETWEEN $1 AND $2 ORDER BY date',
      [startDate, endDate]
    );

    res.json({ workPlans: result.rows });
  } catch (error) {
    console.error('Get work plans error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת תכנוני העבודה' });
  }
});

// Create or update work plan
router.post('/', authenticateToken, requirePermission('workplan_edit'), [
  body('date').isISO8601().withMessage('תאריך לא תקין'),
  body('general_tasks').isArray().withMessage('משימות כלליות חייבות להיות מערך'),
  body('shift_tasks').isObject().withMessage('משימות משמרות חייבות להיות אובייקט')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { date, general_tasks, shift_tasks, notes, start_time, end_time } = req.body;

    const result = await pool.query(
      `INSERT INTO work_plans (date, general_tasks, shift_tasks, notes, start_time, end_time) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       ON CONFLICT (date) 
       DO UPDATE SET general_tasks = $2, shift_tasks = $3, notes = $4, start_time = $5, end_time = $6, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [date, general_tasks, JSON.stringify(shift_tasks), notes, start_time, end_time]
    );

    res.json({
      message: 'תכנון עבודה נשמר בהצלחה',
      workPlan: result.rows[0]
    });
  } catch (error) {
    console.error('Save work plan error:', error);
    res.status(500).json({ error: 'שגיאה בשמירת תכנון העבודה' });
  }
});

// Update shift tasks
router.put('/shift-tasks', authenticateToken, requirePermission('workplan_edit'), [
  body('date').isISO8601().withMessage('תאריך לא תקין'),
  body('shift_type').isIn(['morning', 'afternoon', 'evening']).withMessage('סוג משמרת לא תקין'),
  body('tasks').isArray().withMessage('משימות חייבות להיות מערך')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { date, shift_type, tasks } = req.body;

    // Get existing work plan
    const existingPlan = await pool.query(
      'SELECT * FROM work_plans WHERE date = $1',
      [date]
    );

    let shiftTasks = {};
    if (existingPlan.rows.length > 0) {
      shiftTasks = existingPlan.rows[0].shift_tasks || {};
    }

    // Update specific shift tasks
    shiftTasks[shift_type] = tasks;

    const result = await pool.query(
      `INSERT INTO work_plans (date, general_tasks, shift_tasks) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (date) 
       DO UPDATE SET shift_tasks = $3, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [date, existingPlan.rows[0]?.general_tasks || [], JSON.stringify(shiftTasks)]
    );

    res.json({
      message: 'משימות משמרת עודכנו בהצלחה',
      workPlan: result.rows[0]
    });
  } catch (error) {
    console.error('Update shift tasks error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון משימות המשמרת' });
  }
});

// Delete work plan
router.delete('/:date', authenticateToken, requirePermission('workplan_manage'), async (req, res) => {
  try {
    const { date } = req.params;

    const result = await pool.query('DELETE FROM work_plans WHERE date = $1 RETURNING *', [date]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'תכנון עבודה לא נמצא' });
    }

    res.json({
      message: 'תכנון עבודה נמחק בהצלחה',
      workPlan: result.rows[0]
    });
  } catch (error) {
    console.error('Delete work plan error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת תכנון העבודה' });
  }
});

module.exports = router;

