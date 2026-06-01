const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const Session = require('../models/Session');
const logger  = require('../config/logger');

/**
 * Verify JWT access token from Authorization header.
 * Sets req.user = { id, email, role }
 */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = await User.findOne({ _id: decoded.id, deletedAt: null, isActive: true });
    if (!user) return res.status(401).json({ error: 'User not found or deactivated' });

    req.user = { id: user._id.toString(), email: user.email, role: user.role, name: user.name };
    next();
  } catch (err) {
    logger.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

/**
 * Role-based access control middleware factory.
 * Usage: restrictTo('admin', 'super_admin')
 */
const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'You do not have permission to perform this action' });
  }
  next();
};

/**
 * Admin panel JWT (separate secret, separate route)
 */
const adminProtect = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Admin authentication required' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    if (decoded.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid admin token' });
  }
};

module.exports = { protect, restrictTo, adminProtect };
