/**
 * Email Service Utility (Task 28)
 *
 * Handles sending notification emails for user management:
 * - Welcome emails with temporary passwords
 * - Password reset emails
 * - MFA reset notifications
 *
 * Gracefully handles missing SMTP configuration (logs instead of failing)
 */

const nodemailer = require('nodemailer');
const { logger } = require('./logger');

/**
 * Email service class
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.fromAddress = process.env.SMTP_FROM || 'noreply@alramramiapp.com';
    this.companyName = 'Petroleum Business Management';

    this._initializeTransporter();
  }

  /**
   * Initialize the nodemailer transporter
   * @private
   */
  _initializeTransporter() {
    // Check for required SMTP configuration
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!smtpHost || !smtpPort) {
      logger.warn('Email service not configured - SMTP_HOST and SMTP_PORT required', {
        service: 'emailService',
        hasHost: !!smtpHost,
        hasPort: !!smtpPort
      });
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort, 10),
        secure: parseInt(smtpPort, 10) === 465, // SSL for port 465
        auth: smtpUser && smtpPass ? {
          user: smtpUser,
          pass: smtpPass
        } : undefined
      });

      this.isConfigured = true;
      logger.info('Email service configured', {
        service: 'emailService',
        host: smtpHost,
        port: smtpPort,
        secure: parseInt(smtpPort, 10) === 465
      });
    } catch (error) {
      logger.error('Failed to initialize email transporter', {
        service: 'emailService',
        error: error.message
      });
    }
  }

  /**
   * Send an email
   * @private
   * @param {Object} options - Email options
   * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
   */
  async _sendEmail(options) {
    if (!this.isConfigured) {
      logger.warn('Email not sent - service not configured', {
        service: 'emailService',
        to: options.to,
        subject: options.subject
      });
      return {
        success: false,
        error: 'Email service not configured'
      };
    }

    try {
      const result = await this.transporter.sendMail({
        from: `"${this.companyName}" <${this.fromAddress}>`,
        ...options
      });

      logger.info('Email sent successfully', {
        service: 'emailService',
        to: options.to,
        subject: options.subject,
        messageId: result.messageId
      });

      return {
        success: true,
        messageId: result.messageId
      };
    } catch (error) {
      logger.error('Failed to send email', {
        service: 'emailService',
        to: options.to,
        subject: options.subject,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send welcome email with temporary password
   * @param {string} email - User's email address
   * @param {string} tempPassword - Temporary password
   * @param {string} firstName - User's first name
   * @param {string} companyName - Company name for context
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async sendWelcomeEmail(email, tempPassword, firstName, companyName = 'Your Company') {
    const loginUrl = process.env.FRONTEND_URL || 'https://pbm.alramramiapp.com';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .password-box { background: #fff; border: 2px solid #2563eb; padding: 15px; margin: 20px 0; text-align: center; font-size: 18px; font-family: monospace; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px; }
          .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to ${this.companyName}</h1>
          </div>
          <div class="content">
            <p>Hello ${firstName},</p>
            <p>Your account has been created for <strong>${companyName}</strong>.</p>

            <p>Here are your login credentials:</p>

            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Temporary Password:</strong></p>
            <div class="password-box">${tempPassword}</div>

            <div class="warning">
              <strong>Important:</strong> You will be required to change this password when you first log in.
            </div>

            <p>
              <a href="${loginUrl}" class="button">Login Now</a>
            </p>

            <p>If you have any questions, please contact your administrator.</p>
          </div>
          <div class="footer">
            <p>This is an automated message from ${this.companyName}.</p>
            <p>Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
Welcome to ${this.companyName}!

Hello ${firstName},

Your account has been created for ${companyName}.

Login Credentials:
Email: ${email}
Temporary Password: ${tempPassword}

IMPORTANT: You will be required to change this password when you first log in.

Login at: ${loginUrl}

If you have any questions, please contact your administrator.

This is an automated message. Please do not reply to this email.
    `.trim();

    return this._sendEmail({
      to: email,
      subject: `Welcome to ${this.companyName} - Your Account Has Been Created`,
      html: htmlContent,
      text: textContent
    });
  }

  /**
   * Send password reset email (admin-initiated)
   * @param {string} email - User's email address
   * @param {string} tempPassword - New temporary password
   * @param {string} firstName - User's first name
   * @param {string} adminName - Name of admin who reset the password
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async sendPasswordResetEmail(email, tempPassword, firstName, adminName = 'An administrator') {
    const loginUrl = process.env.FRONTEND_URL || 'https://pbm.alramramiapp.com';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #dc2626; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .password-box { background: #fff; border: 2px solid #dc2626; padding: 15px; margin: 20px 0; text-align: center; font-size: 18px; font-family: monospace; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px; }
          .warning { background: #fee2e2; border-left: 4px solid #dc2626; padding: 10px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset</h1>
          </div>
          <div class="content">
            <p>Hello ${firstName},</p>

            <p>${adminName} has reset your password.</p>

            <p><strong>Your new temporary password:</strong></p>
            <div class="password-box">${tempPassword}</div>

            <div class="warning">
              <strong>Important:</strong> You will be required to change this password when you next log in.
              If you did not request this reset, please contact your administrator immediately.
            </div>

            <p>
              <a href="${loginUrl}" class="button">Login Now</a>
            </p>
          </div>
          <div class="footer">
            <p>This is an automated message from ${this.companyName}.</p>
            <p>Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
Password Reset - ${this.companyName}

Hello ${firstName},

${adminName} has reset your password.

Your new temporary password: ${tempPassword}

IMPORTANT: You will be required to change this password when you next log in.
If you did not request this reset, please contact your administrator immediately.

Login at: ${loginUrl}

This is an automated message. Please do not reply to this email.
    `.trim();

    return this._sendEmail({
      to: email,
      subject: `${this.companyName} - Your Password Has Been Reset`,
      html: htmlContent,
      text: textContent
    });
  }

  /**
   * Send MFA reset notification
   * @param {string} email - User's email address
   * @param {string} firstName - User's first name
   * @param {string} adminName - Name of admin who reset MFA
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async sendMfaResetNotification(email, firstName, adminName = 'An administrator') {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f59e0b; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>MFA Reset Notification</h1>
          </div>
          <div class="content">
            <p>Hello ${firstName},</p>

            <p>Your Multi-Factor Authentication (MFA) has been reset by ${adminName}.</p>

            <div class="warning">
              <strong>What this means:</strong>
              <ul>
                <li>Your previous authenticator app codes will no longer work</li>
                <li>You will need to set up MFA again when you next log in (if required)</li>
              </ul>
            </div>

            <p>If you did not request this reset, please contact your administrator immediately.</p>
          </div>
          <div class="footer">
            <p>This is an automated message from ${this.companyName}.</p>
            <p>Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
MFA Reset Notification - ${this.companyName}

Hello ${firstName},

Your Multi-Factor Authentication (MFA) has been reset by ${adminName}.

What this means:
- Your previous authenticator app codes will no longer work
- You will need to set up MFA again when you next log in (if required)

If you did not request this reset, please contact your administrator immediately.

This is an automated message. Please do not reply to this email.
    `.trim();

    return this._sendEmail({
      to: email,
      subject: `${this.companyName} - Your MFA Has Been Reset`,
      html: htmlContent,
      text: textContent
    });
  }

  /**
   * Send account deactivation notification
   * @param {string} email - User's email address
   * @param {string} firstName - User's first name
   * @param {string} adminName - Name of admin who deactivated
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async sendDeactivationNotification(email, firstName, adminName = 'An administrator') {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #6b7280; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Account Deactivated</h1>
          </div>
          <div class="content">
            <p>Hello ${firstName},</p>

            <p>Your account on ${this.companyName} has been deactivated by ${adminName}.</p>

            <p>You will no longer be able to log in to the system.</p>

            <p>If you believe this was done in error, please contact your administrator.</p>
          </div>
          <div class="footer">
            <p>This is an automated message from ${this.companyName}.</p>
            <p>Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
Account Deactivated - ${this.companyName}

Hello ${firstName},

Your account on ${this.companyName} has been deactivated by ${adminName}.

You will no longer be able to log in to the system.

If you believe this was done in error, please contact your administrator.

This is an automated message. Please do not reply to this email.
    `.trim();

    return this._sendEmail({
      to: email,
      subject: `${this.companyName} - Account Deactivated`,
      html: htmlContent,
      text: textContent
    });
  }

  /**
   * Check if email service is configured and ready
   * @returns {boolean}
   */
  isReady() {
    return this.isConfigured;
  }

  /**
   * Test email configuration by sending a test email
   * @param {string} testEmail - Email address to send test to
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async sendTestEmail(testEmail) {
    return this._sendEmail({
      to: testEmail,
      subject: `${this.companyName} - Email Configuration Test`,
      html: `<p>This is a test email from ${this.companyName}. If you received this, email is working correctly.</p>`,
      text: `This is a test email from ${this.companyName}. If you received this, email is working correctly.`
    });
  }
}

// Export singleton instance
const emailService = new EmailService();

module.exports = emailService;
