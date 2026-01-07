const jwt = require('jsonwebtoken');
const { logger, auditLog } = require('./logger');

// Generate JWT token
const generateToken = (payload) => {
  try {
    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      issuer: 'petroleum-business-api',
      audience: 'petroleum-business-client'
    });
  } catch (error) {
    logger.error('Error generating JWT token', { error: error.message });
    throw new Error('Token generation failed');
  }
};

// Generate refresh token
const generateRefreshToken = (payload) => {
  try {
    return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      issuer: 'petroleum-business-api',
      audience: 'petroleum-business-client'
    });
  } catch (error) {
    logger.error('Error generating refresh token', { error: error.message });
    throw new Error('Refresh token generation failed');
  }
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'petroleum-business-api',
      audience: 'petroleum-business-client'
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.warn('JWT token expired', { token: token.substring(0, 20) + '...' });
      throw new Error('Token expired');
    } else if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid JWT token', { error: error.message });
      throw new Error('Invalid token');
    } else {
      logger.error('JWT verification error', { error: error.message });
      throw new Error('Token verification failed');
    }
  }
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
      issuer: 'petroleum-business-api',
      audience: 'petroleum-business-client'
    });
  } catch (error) {
    logger.warn('Refresh token verification failed', { error: error.message });
    throw new Error('Invalid refresh token');
  }
};

// Generate token pair (access + refresh)
const generateTokenPair = (userId, email, role, companyId, permissions = [], roleId = null) => {
  const payload = {
    userId,
    email,
    role,
    companyId,
    permissions,
    roleId,
    tokenType: 'access'
  };

  const refreshPayload = {
    userId,
    email,
    tokenType: 'refresh'
  };

  const accessToken = generateToken(payload);
  const refreshToken = generateRefreshToken(refreshPayload);

  // Log token generation for audit
  auditLog('TOKEN_GENERATED', userId, {
    email,
    role,
    companyId,
    tokenType: 'both'
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    tokenType: 'Bearer'
  };
};

// Decode token without verification (for debugging)
const decodeToken = (token) => {
  try {
    return jwt.decode(token, { complete: true });
  } catch (error) {
    logger.error('Error decoding token', { error: error.message });
    return null;
  }
};

module.exports = {
  generateToken,
  generateRefreshToken,
  verifyToken,
  verifyRefreshToken,
  generateTokenPair,
  decodeToken
};