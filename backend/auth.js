const jwt = require('jsonwebtoken');
const config = require('../config/config');
const pool = require('../database/connection');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'נדרש טוקן אימות' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT.SECRET);
    
    // Get user from database
    const userResult = await pool.query(
      'SELECT id, username, email, name, role, permissions, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'משתמש לא נמצא' });
    }

    const user = userResult.rows[0];
    
    if (!user.is_active) {
      return res.status(401).json({ error: 'חשבון המשתמש לא פעיל' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('JWT verification error:', error);
    return res.status(403).json({ error: 'טוקן לא תקין' });
  }
};

const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'נדרש אימות' });
    }

    // Admin has all permissions
    if (req.user.role === 'admin') {
      return next();
    }

    // Check if user has the required permission
    if (!req.user.permissions.includes(permission)) {
      return res.status(403).json({ error: 'אין לך הרשאה לבצע פעולה זו' });
    }

    next();
  };
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'נדרש אימות' });
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'אין לך הרשאה לבצע פעולה זו' });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  requirePermission,
  requireRole
};

