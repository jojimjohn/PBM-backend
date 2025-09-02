const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const BackupManager = require('../utils/backupManager');
const Joi = require('joi');
const winston = require('winston');

// Initialize backup manager
const backupManager = new BackupManager();

// Validation schemas
const createBackupSchema = Joi.object({
  companyId: Joi.string().valid('al-ramrami', 'pride-muscat').optional(),
  compress: Joi.boolean().default(true)
});

const restoreBackupSchema = Joi.object({
  companyId: Joi.string().valid('al-ramrami', 'pride-muscat').required(),
  backupFilename: Joi.string().required()
});

// GET /backups - List all backups
router.get('/', requirePermission(['system:admin']), async (req, res) => {
  try {
    const { companyId } = req.query;
    const backups = await backupManager.listBackups(companyId);
    
    winston.info('Backups retrieved', {
      userId: req.user.id,
      companyFilter: companyId,
      count: backups.length
    });
    
    res.json({
      success: true,
      data: backups
    });
    
  } catch (error) {
    winston.error('Error retrieving backups', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve backups'
    });
  }
});

// GET /backups/stats - Get backup statistics
router.get('/stats', requirePermission(['system:admin']), async (req, res) => {
  try {
    const stats = await backupManager.getBackupStats();
    
    winston.info('Backup statistics retrieved', {
      userId: req.user.id,
      totalBackups: stats.totalBackups,
      totalSize: stats.totalSizeFormatted
    });
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    winston.error('Error retrieving backup statistics', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve backup statistics'
    });
  }
});

// POST /backups - Create new backup
router.post('/', 
  requirePermission(['system:admin']),
  validate(createBackupSchema),
  async (req, res) => {
    try {
      const { companyId, compress } = req.body;
      
      let result;
      if (companyId) {
        // Create backup for specific company
        result = { [companyId]: await backupManager.createBackup(companyId, compress) };
      } else {
        // Create backups for all companies
        result = await backupManager.createAllBackups(compress);
      }
      
      const successful = Object.values(result).filter(r => r.success).length;
      const failed = Object.values(result).filter(r => !r.success).length;
      
      winston.info('Backup creation completed', {
        userId: req.user.id,
        companyId: companyId || 'all',
        successful,
        failed,
        compress
      });
      
      res.json({
        success: true,
        data: {
          results: result,
          summary: {
            successful,
            failed,
            total: Object.keys(result).length
          }
        },
        message: `Backup completed: ${successful} successful, ${failed} failed`
      });
      
    } catch (error) {
      winston.error('Error creating backup', {
        error: error.message,
        userId: req.user.id,
        companyId: req.body.companyId
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to create backup'
      });
    }
  }
);

// POST /backups/restore - Restore database from backup
router.post('/restore',
  requirePermission(['system:admin']),
  validate(restoreBackupSchema),
  async (req, res) => {
    try {
      const { companyId, backupFilename } = req.body;
      
      // Warning: This is a destructive operation
      winston.warn('Database restore initiated', {
        userId: req.user.id,
        companyId,
        backupFilename,
        userEmail: req.user.email
      });
      
      const result = await backupManager.restoreBackup(companyId, backupFilename);
      
      winston.info('Database restore completed', {
        userId: req.user.id,
        companyId,
        backupFilename,
        restoredAt: result.restoredAt
      });
      
      res.json({
        success: true,
        data: result,
        message: 'Database restored successfully'
      });
      
    } catch (error) {
      winston.error('Error restoring database', {
        error: error.message,
        userId: req.user.id,
        companyId: req.body.companyId,
        backupFilename: req.body.backupFilename
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to restore database'
      });
    }
  }
);

// DELETE /backups/:filename - Delete a specific backup
router.delete('/:filename', requirePermission(['system:admin']), async (req, res) => {
  try {
    const { filename } = req.params;
    const fs = require('fs').promises;
    const path = require('path');
    
    const backupDir = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
    const backupPath = path.join(backupDir, filename);
    
    // Verify file exists and is a backup file
    if (!filename.endsWith('.sql') && !filename.endsWith('.sql.gz')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid backup filename'
      });
    }
    
    await fs.access(backupPath);
    await fs.unlink(backupPath);
    
    winston.info('Backup file deleted', {
      userId: req.user.id,
      filename,
      path: backupPath
    });
    
    res.json({
      success: true,
      message: 'Backup file deleted successfully'
    });
    
  } catch (error) {
    winston.error('Error deleting backup', {
      error: error.message,
      userId: req.user.id,
      filename: req.params.filename
    });
    
    if (error.code === 'ENOENT') {
      res.status(404).json({
        success: false,
        error: 'Backup file not found'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to delete backup file'
      });
    }
  }
});

// POST /backups/cleanup - Clean up old backups
router.post('/cleanup', requirePermission(['system:admin']), async (req, res) => {
  try {
    const result = await backupManager.cleanupOldBackups();
    
    winston.info('Backup cleanup completed', {
      userId: req.user.id,
      deletedCount: result.deleted
    });
    
    res.json({
      success: true,
      data: result,
      message: `Cleaned up ${result.deleted} old backup files`
    });
    
  } catch (error) {
    winston.error('Error during backup cleanup', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup old backups'
    });
  }
});

// GET /backups/test - Test backup system
router.get('/test', requirePermission(['system:admin']), async (req, res) => {
  try {
    const result = await backupManager.testBackupSystem();
    
    winston.info('Backup system test completed', {
      userId: req.user.id,
      success: result.success
    });
    
    if (result.success) {
      res.json({
        success: true,
        data: result,
        message: 'Backup system test passed'
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: 'Backup system test failed'
      });
    }
    
  } catch (error) {
    winston.error('Error testing backup system', {
      error: error.message,
      userId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to test backup system'
    });
  }
});

// Initialize backup manager on module load
(async () => {
  try {
    await backupManager.initialize();
  } catch (error) {
    winston.error('Failed to initialize backup manager', {
      error: error.message
    });
  }
})();

module.exports = router;