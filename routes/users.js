const express = require('express');
const router = express.Router();
const { getDbConnection } = require('../config/database');
const { logger } = require('../utils/logger');

// GET /api/users - Get all users for the company
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.user;
    const db = getDbConnection(companyId);

    const users = await db('users')
      .select('id', 'email', 'firstName', 'lastName', 'role', 'isActive')
      .where({ companyId, isActive: true })
      .orderBy('firstName', 'asc');

    // Format users with full name
    const formattedUsers = users.map(user => ({
      ...user,
      fullName: `${user.firstName} ${user.lastName}`
    }));

    res.json({
      success: true,
      data: formattedUsers
    });

  } catch (error) {
    logger.error('Error fetching users', {
      error: error.message,
      companyId: req.user.companyId,
      userId: req.user.userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

module.exports = router;
