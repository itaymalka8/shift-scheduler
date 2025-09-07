const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../database/connection');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Get all vehicles
router.get('/', authenticateToken, requirePermission('vehicles_view'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vehicles ORDER BY license_plate');
    res.json({ vehicles: result.rows });
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת רשימת הרכבים' });
  }
});

// Get vehicle by ID
router.get('/:id', authenticateToken, requirePermission('vehicles_view'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM vehicles WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'רכב לא נמצא' });
    }

    res.json({ vehicle: result.rows[0] });
  } catch (error) {
    console.error('Get vehicle error:', error);
    res.status(500).json({ error: 'שגיאה בקבלת פרטי הרכב' });
  }
});

// Create new vehicle
router.post('/', authenticateToken, requirePermission('vehicles_edit'), [
  body('license_plate').notEmpty().withMessage('מספר רישוי חובה'),
  body('vehicle_type').notEmpty().withMessage('סוג רכב חובה')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { license_plate, vehicle_type, model, year, status, last_inspection, next_inspection, notes } = req.body;

    const result = await pool.query(
      `INSERT INTO vehicles (license_plate, vehicle_type, model, year, status, last_inspection, next_inspection, notes) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [license_plate, vehicle_type, model, year, status, last_inspection, next_inspection, notes]
    );

    res.status(201).json({
      message: 'רכב נוסף בהצלחה',
      vehicle: result.rows[0]
    });
  } catch (error) {
    console.error('Create vehicle error:', error);
    res.status(500).json({ error: 'שגיאה בהוספת הרכב' });
  }
});

// Update vehicle
router.put('/:id', authenticateToken, requirePermission('vehicles_edit'), [
  body('license_plate').notEmpty().withMessage('מספר רישוי חובה'),
  body('vehicle_type').notEmpty().withMessage('סוג רכב חובה')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { license_plate, vehicle_type, model, year, status, last_inspection, next_inspection, notes } = req.body;

    const result = await pool.query(
      `UPDATE vehicles 
       SET license_plate = $1, vehicle_type = $2, model = $3, year = $4, status = $5, 
           last_inspection = $6, next_inspection = $7, notes = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
      [license_plate, vehicle_type, model, year, status, last_inspection, next_inspection, notes, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'רכב לא נמצא' });
    }

    res.json({
      message: 'רכב עודכן בהצלחה',
      vehicle: result.rows[0]
    });
  } catch (error) {
    console.error('Update vehicle error:', error);
    res.status(500).json({ error: 'שגיאה בעדכון הרכב' });
  }
});

// Delete vehicle
router.delete('/:id', authenticateToken, requirePermission('vehicles_manage'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM vehicles WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'רכב לא נמצא' });
    }

    res.json({
      message: 'רכב נמחק בהצלחה',
      vehicle: result.rows[0]
    });
  } catch (error) {
    console.error('Delete vehicle error:', error);
    res.status(500).json({ error: 'שגיאה במחיקת הרכב' });
  }
});

module.exports = router;

