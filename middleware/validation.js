const Joi = require('joi');
const { logger } = require('../utils/logger');

// Generic validation middleware
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      logger.warn('Validation failed', {
        endpoint: req.originalUrl,
        errors: errors,
        ip: req.ip
      });

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    // Replace req.body with sanitized/validated data
    req.body = value;
    next();
  };
};

// Common validation schemas
const schemas = {
  // Authentication schemas
  login: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .max(255)
      .lowercase()
      .trim(),
    password: Joi.string()
      .min(8)
      .max(128)
      .required(),
    companyId: Joi.string()
      .valid('al-ramrami', 'pride-muscat')
      .required()
  }),

  register: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .max(255)
      .lowercase()
      .trim(),
    password: Joi.string()
      .min(8)
      .max(128)
      .required()
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .message('Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'),
    confirmPassword: Joi.string()
      .valid(Joi.ref('password'))
      .required()
      .messages({
        'any.only': 'Passwords do not match'
      }),
    firstName: Joi.string()
      .min(2)
      .max(50)
      .required()
      .trim()
      .pattern(/^[a-zA-Z\s]+$/)
      .message('First name must contain only letters and spaces'),
    lastName: Joi.string()
      .min(2)
      .max(50)
      .required()
      .trim()
      .pattern(/^[a-zA-Z\s]+$/)
      .message('Last name must contain only letters and spaces'),
    role: Joi.string()
      .valid('company-admin', 'manager', 'sales-staff', 'purchase-staff', 'accounts-staff')
      .required(),
    companyId: Joi.string()
      .valid('al-ramrami', 'pride-muscat')
      .required()
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string()
      .required(),
    newPassword: Joi.string()
      .min(8)
      .max(128)
      .required()
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .message('Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'),
    confirmNewPassword: Joi.string()
      .valid(Joi.ref('newPassword'))
      .required()
      .messages({
        'any.only': 'Passwords do not match'
      })
  }),

  refreshToken: Joi.object({
    refreshToken: Joi.string()
      .required()
  }),

  // Customer/Supplier schemas
  customer: Joi.object({
    name: Joi.string()
      .min(2)
      .max(100)
      .required()
      .trim(),
    email: Joi.string()
      .email()
      .max(255)
      .lowercase()
      .trim()
      .allow(''),
    phone: Joi.string()
      .pattern(/^\+?[\d\s\-\(\)]+$/)
      .max(20)
      .trim()
      .allow(''),
    address: Joi.string()
      .max(500)
      .trim()
      .allow(''),
    customerType: Joi.string()
      .valid('walk-in', 'project-based', 'contract')
      .required(),
    vatRegistration: Joi.string()
      .max(50)
      .trim()
      .allow(''),
    companyId: Joi.string()
      .valid('al-ramrami', 'pride-muscat')
      .required()
  }),

  // Generic ID validation
  id: Joi.object({
    id: Joi.number()
      .integer()
      .positive()
      .required()
  }),

  // Company ID validation
  companyId: Joi.object({
    companyId: Joi.string()
      .valid('al-ramrami', 'pride-muscat')
      .required()
  })
};

// Sanitize input to prevent XSS
const sanitizeInput = (obj) => {
  if (typeof obj === 'string') {
    return obj
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = sanitizeInput(obj[key]);
      }
    }
    return sanitized;
  }
  
  return obj;
};

// Sanitization middleware
const sanitize = (req, res, next) => {
  req.body = sanitizeInput(req.body);
  req.query = sanitizeInput(req.query);
  req.params = sanitizeInput(req.params);
  next();
};

// Parameter validation middleware
const validateParams = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid parameters',
        details: error.details[0].message
      });
    }

    req.params = value;
    next();
  };
};

module.exports = {
  validate,
  validateParams,
  sanitize,
  schemas
};