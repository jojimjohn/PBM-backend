const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { logger } = require('./logger');
const cron = require('node-cron');

/**
 * Backup Manager
 * Handles automated database backups with rotation and restoration
 */
class BackupManager {
  constructor() {
    this.backupDir = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
    this.maxBackups = parseInt(process.env.MAX_BACKUPS) || 30; // Keep 30 days of backups
    this.mysqlPath = process.env.MYSQL_PATH || 'mysqldump';
    
    // Database configurations
    this.databases = {
      'al-ramrami': process.env.AL_RAMRAMI_DB,
      'pride-muscat': process.env.PRIDE_MUSCAT_DB
    };
    
    this.dbConfig = {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    };
  }

  /**
   * Initialize backup manager
   */
  async initialize() {
    try {
      // Create backup directory if it doesn't exist
      await this.ensureBackupDir();
      
      // Schedule automatic backups
      this.scheduleBackups();
      
      logger.info('Backup Manager initialized', {
        backupDir: this.backupDir,
        maxBackups: this.maxBackups,
        scheduledBackups: process.env.BACKUP_ENABLED === 'true'
      });
    } catch (error) {
      logger.error('Failed to initialize Backup Manager', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Ensure backup directory exists
   */
  async ensureBackupDir() {
    try {
      await fs.access(this.backupDir);
    } catch (error) {
      logger.info('Creating backup directory', { backupDir: this.backupDir });
      await fs.mkdir(this.backupDir, { recursive: true });
    }
  }

  /**
   * Create backup for a specific database
   * @param {string} companyId - Company ID
   * @param {boolean} compress - Whether to compress the backup
   */
  async createBackup(companyId, compress = true) {
    try {
      const database = this.databases[companyId];
      if (!database) {
        throw new Error(`Database not found for company: ${companyId}`);
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${database}_${timestamp}.sql`;
      const backupPath = path.join(this.backupDir, filename);
      const compressedPath = `${backupPath}.gz`;

      logger.info('Starting database backup', {
        database,
        companyId,
        backupPath: compress ? compressedPath : backupPath
      });

      // Build mysqldump command
      const dumpCommand = [
        this.mysqlPath,
        `--host=${this.dbConfig.host}`,
        `--port=${this.dbConfig.port}`,
        `--user=${this.dbConfig.user}`,
        `--password=${this.dbConfig.password}`,
        '--single-transaction',
        '--routines',
        '--triggers',
        '--events',
        '--hex-blob',
        '--add-drop-database',
        '--databases',
        database
      ].join(' ');

      // Execute backup
      let finalCommand;
      if (compress) {
        finalCommand = `${dumpCommand} | gzip > "${compressedPath}"`;
      } else {
        finalCommand = `${dumpCommand} > "${backupPath}"`;
      }

      await execAsync(finalCommand);

      // Verify backup file was created
      const finalPath = compress ? compressedPath : backupPath;
      const stats = await fs.stat(finalPath);
      
      if (stats.size === 0) {
        throw new Error('Backup file is empty');
      }

      logger.info('Database backup completed successfully', {
        database,
        companyId,
        backupPath: finalPath,
        fileSize: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
        compressed: compress
      });

      return {
        success: true,
        filename: path.basename(finalPath),
        path: finalPath,
        size: stats.size,
        compressed: compress,
        createdAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Database backup failed', {
        error: error.message,
        companyId,
        database: this.databases[companyId]
      });
      throw error;
    }
  }

  /**
   * Create backups for all databases
   */
  async createAllBackups(compress = true) {
    const results = {};
    
    for (const [companyId] of Object.entries(this.databases)) {
      try {
        results[companyId] = await this.createBackup(companyId, compress);
      } catch (error) {
        results[companyId] = {
          success: false,
          error: error.message
        };
      }
    }

    // Clean up old backups after creating new ones
    await this.cleanupOldBackups();

    return results;
  }

  /**
   * Restore database from backup
   * @param {string} companyId - Company ID
   * @param {string} backupFilename - Backup filename
   */
  async restoreBackup(companyId, backupFilename) {
    try {
      const database = this.databases[companyId];
      if (!database) {
        throw new Error(`Database not found for company: ${companyId}`);
      }

      const backupPath = path.join(this.backupDir, backupFilename);
      
      // Check if backup file exists
      await fs.access(backupPath);

      logger.info('Starting database restore', {
        database,
        companyId,
        backupPath
      });

      // Determine if file is compressed
      const isCompressed = backupFilename.endsWith('.gz');

      // Build restore command
      const mysqlCommand = [
        'mysql',
        `--host=${this.dbConfig.host}`,
        `--port=${this.dbConfig.port}`,
        `--user=${this.dbConfig.user}`,
        `--password=${this.dbConfig.password}`
      ].join(' ');

      let restoreCommand;
      if (isCompressed) {
        restoreCommand = `gunzip < "${backupPath}" | ${mysqlCommand}`;
      } else {
        restoreCommand = `${mysqlCommand} < "${backupPath}"`;
      }

      await execAsync(restoreCommand);

      logger.info('Database restore completed successfully', {
        database,
        companyId,
        backupFile: backupFilename
      });

      return {
        success: true,
        database,
        backupFile: backupFilename,
        restoredAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Database restore failed', {
        error: error.message,
        companyId,
        backupFile: backupFilename
      });
      throw error;
    }
  }

  /**
   * List available backups
   * @param {string} companyId - Optional company ID filter
   */
  async listBackups(companyId = null) {
    try {
      const files = await fs.readdir(this.backupDir);
      let backupFiles = files.filter(file => file.endsWith('.sql') || file.endsWith('.sql.gz'));

      if (companyId && this.databases[companyId]) {
        const database = this.databases[companyId];
        backupFiles = backupFiles.filter(file => file.startsWith(database));
      }

      const backups = await Promise.all(
        backupFiles.map(async (filename) => {
          const filepath = path.join(this.backupDir, filename);
          const stats = await fs.stat(filepath);
          
          // Extract database name and timestamp from filename
          const parts = filename.replace('.sql.gz', '').replace('.sql', '').split('_');
          const database = parts[0];
          const timestamp = parts.slice(1).join('_');

          return {
            filename,
            database,
            companyId: Object.keys(this.databases).find(key => this.databases[key] === database),
            size: stats.size,
            sizeFormatted: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
            compressed: filename.endsWith('.gz'),
            createdAt: stats.birthtime,
            timestamp
          };
        })
      );

      // Sort by creation date (newest first)
      backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return backups;
    } catch (error) {
      logger.error('Failed to list backups', {
        error: error.message,
        companyId
      });
      throw error;
    }
  }

  /**
   * Clean up old backups (keep only maxBackups count)
   */
  async cleanupOldBackups() {
    try {
      const backups = await this.listBackups();
      
      if (backups.length <= this.maxBackups) {
        return { deleted: 0 };
      }

      // Group by company/database
      const backupsByCompany = {};
      backups.forEach(backup => {
        const key = backup.companyId || backup.database;
        if (!backupsByCompany[key]) {
          backupsByCompany[key] = [];
        }
        backupsByCompany[key].push(backup);
      });

      let totalDeleted = 0;

      // Clean up each company's backups separately
      for (const [companyKey, companyBackups] of Object.entries(backupsByCompany)) {
        if (companyBackups.length > this.maxBackups) {
          const toDelete = companyBackups.slice(this.maxBackups);
          
          for (const backup of toDelete) {
            try {
              await fs.unlink(path.join(this.backupDir, backup.filename));
              totalDeleted++;
              
              logger.info('Old backup deleted', {
                filename: backup.filename,
                companyId: backup.companyId,
                createdAt: backup.createdAt
              });
            } catch (error) {
              logger.warn('Failed to delete old backup', {
                filename: backup.filename,
                error: error.message
              });
            }
          }
        }
      }

      logger.info('Backup cleanup completed', {
        totalDeleted,
        maxBackups: this.maxBackups
      });

      return { deleted: totalDeleted };
    } catch (error) {
      logger.error('Backup cleanup failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Schedule automatic backups
   */
  scheduleBackups() {
    if (process.env.BACKUP_ENABLED !== 'true') {
      logger.info('Automatic backups are disabled');
      return;
    }

    // Daily backup at 2 AM
    const dailySchedule = process.env.BACKUP_CRON || '0 2 * * *';
    
    cron.schedule(dailySchedule, async () => {
      logger.info('Starting scheduled backup');
      try {
        const results = await this.createAllBackups(true);
        
        const successful = Object.values(results).filter(r => r.success).length;
        const failed = Object.values(results).filter(r => !r.success).length;
        
        logger.info('Scheduled backup completed', {
          successful,
          failed,
          results
        });
      } catch (error) {
        logger.error('Scheduled backup failed', {
          error: error.message
        });
      }
    });

    logger.info('Backup scheduler initialized', {
      schedule: dailySchedule,
      timezone: process.env.TZ || 'UTC'
    });
  }

  /**
   * Test backup system
   */
  async testBackupSystem() {
    try {
      logger.info('Testing backup system...');

      // Test backup directory creation
      await this.ensureBackupDir();
      
      // Test mysqldump availability
      await execAsync(`${this.mysqlPath} --version`);
      
      // Test database connectivity
      for (const [companyId, database] of Object.entries(this.databases)) {
        const testCommand = [
          'mysql',
          `--host=${this.dbConfig.host}`,
          `--port=${this.dbConfig.port}`,
          `--user=${this.dbConfig.user}`,
          `--password=${this.dbConfig.password}`,
          '-e',
          '"SELECT 1"',
          database
        ].join(' ');
        
        await execAsync(testCommand);
        logger.info('Database connection test passed', { companyId, database });
      }

      logger.info('Backup system test completed successfully');
      return { success: true, message: 'All tests passed' };
      
    } catch (error) {
      logger.error('Backup system test failed', {
        error: error.message
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupStats() {
    try {
      const backups = await this.listBackups();
      
      const stats = {
        totalBackups: backups.length,
        totalSize: backups.reduce((sum, backup) => sum + backup.size, 0),
        companyBreakdown: {},
        oldestBackup: null,
        newestBackup: null
      };

      // Format total size
      stats.totalSizeFormatted = `${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`;

      // Company breakdown
      backups.forEach(backup => {
        const companyId = backup.companyId || 'unknown';
        if (!stats.companyBreakdown[companyId]) {
          stats.companyBreakdown[companyId] = {
            count: 0,
            size: 0
          };
        }
        stats.companyBreakdown[companyId].count++;
        stats.companyBreakdown[companyId].size += backup.size;
      });

      // Format company breakdown sizes
      Object.keys(stats.companyBreakdown).forEach(companyId => {
        const company = stats.companyBreakdown[companyId];
        company.sizeFormatted = `${(company.size / 1024 / 1024).toFixed(2)} MB`;
      });

      // Oldest and newest backups
      if (backups.length > 0) {
        stats.oldestBackup = backups[backups.length - 1];
        stats.newestBackup = backups[0];
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get backup statistics', {
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = BackupManager;