const AuditLog = require('../models/AuditLog');
const logger   = require('../config/logger');

/**
 * Creates an audit log entry.
 * Called from route handlers after sensitive operations.
 */
const audit = async ({ userId, action, resource, resourceId, details, req, success = true }) => {
  try {
    await AuditLog.create({
      userId:    userId || null,
      action,
      resource,
      resourceId: resourceId ? String(resourceId) : undefined,
      details,
      ip:        req?.ip || req?.headers?.['x-forwarded-for'],
      userAgent: req?.headers?.['user-agent'],
      success
    });
  } catch (err) {
    logger.error('Audit log failed:', err.message);
  }
};

module.exports = { audit };
