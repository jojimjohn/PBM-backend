/**
 * Compliance Routes — Oman MD 18/2017 Waste Manifest
 *
 * Endpoints:
 *   GET  /api/compliance/wcn/:id/pdf      — Download WCN manifest PDF
 *   GET  /api/compliance/wcn/verify/:wcn  — Public WCN verification page data
 *   GET  /api/compliance/company-info     — Fetch compliance settings for UI
 *   PUT  /api/compliance/company-info     — Save compliance settings
 */
const express = require('express');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const { renderWcnManifest } = require('../templates/wcnManifest');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helper: fetch company compliance settings from system_settings table
// ---------------------------------------------------------------------------
const COMPLIANCE_KEYS = [
  'company.name',
  'company.cr_number',
  'company.vat_registration',
  'company.environmental_permit_number',
  'company.authorized_signatory_name',
  'company.treatment_method',
  'company.address'
];

async function getComplianceSettings(db, companyId) {
  const rows = await db('system_settings')
    .where('company_id', companyId)
    .whereIn('setting_key', COMPLIANCE_KEYS)
    .select('setting_key', 'setting_value');

  const settings = {};
  rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
  return settings;
}

// ============================================================================
// GET /compliance/company-info — for the settings UI
// ============================================================================
router.get('/company-info', requirePermission('MANAGE_SETTINGS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const settings = await getComplianceSettings(db, req.user.companyId);
    res.json({ success: true, data: settings });
  } catch (error) {
    logger.error('Failed to fetch compliance settings', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
});

// ============================================================================
// PUT /compliance/company-info — save compliance settings
// ============================================================================
router.put('/company-info', requirePermission('MANAGE_SETTINGS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { userId: actorId, companyId } = req.user;
    const updates = req.body || {};

    await db.transaction(async (trx) => {
      for (const key of COMPLIANCE_KEYS) {
        if (updates[key] === undefined) continue;

        const existing = await trx('system_settings')
          .where({ company_id: companyId, setting_key: key })
          .first();

        if (existing) {
          await trx('system_settings')
            .where({ company_id: companyId, setting_key: key })
            .update({
              setting_value: updates[key] || '',
              updated_at: trx.fn.now(),
              updated_by: actorId
            });
        } else {
          await trx('system_settings').insert({
            company_id: companyId,
            setting_key: key,
            setting_value: updates[key] || '',
            setting_type: 'string',
            category: 'compliance',
            created_by: actorId,
            updated_by: actorId
          });
        }
      }
    });

    auditLog('COMPLIANCE_SETTINGS_UPDATED', actorId, { keys: Object.keys(updates) });
    const saved = await getComplianceSettings(db, companyId);
    res.json({ success: true, data: saved, message: 'Compliance settings saved' });
  } catch (error) {
    logger.error('Failed to save compliance settings', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: 'Failed to save settings', detail: error.message });
  }
});

// ============================================================================
// GET /compliance/wcn/:id/pdf — generate and download WCN manifest
// ============================================================================
router.get('/wcn/:id/pdf', requirePermission('VIEW_COLLECTIONS'), async (req, res) => {
  try {
    const db = getDbConnection(req.user.companyId);
    const { id } = req.params;

    // Fetch collection order with supplier + location + driver + vehicle
    const co = await db('collection_orders as co')
      .leftJoin('suppliers as sup', 'sup.id', 'co.supplierId')
      .leftJoin('supplier_locations as loc', 'loc.id', 'co.locationId')
      .leftJoin('employees as drv', 'drv.id', 'co.driver_employee_id')
      .leftJoin('vehicles as v', 'v.id', 'co.vehicle_id')
      .leftJoin('users as fin', 'fin.id', 'co.finalized_by')
      .where('co.id', id)
      .select(
        'co.*',
        'sup.name as supplierName',
        'sup.vatRegistration as supplierVat',
        'sup.businessRegistration as supplierCr',
        'sup.contactPerson as supplierContact',
        'sup.phone as supplierPhone',
        'sup.email as supplierEmail',
        'sup.address as supplierAddress',
        'loc.locationName',
        'loc.address as locationAddress',
        'drv.full_name as driverFullName',
        'drv.employee_code as driverCode',
        'v.make as vehicleMake',
        'v.model as vehicleModel',
        db.raw("CONCAT(fin.firstName, ' ', fin.lastName) as finalizedByName")
      )
      .first();

    if (!co) {
      return res.status(404).json({ success: false, error: 'Collection order not found' });
    }

    if (!co.is_finalized) {
      return res.status(400).json({ success: false, error: 'WCN must be finalized before manifest can be generated' });
    }

    // Fetch items + material details
    const items = await db('collection_items as ci')
      .leftJoin('materials as m', 'm.id', 'ci.materialId')
      .where('ci.collectionOrderId', id)
      .select(
        'ci.*',
        'm.name as materialName',
        'm.category',
        'm.unit'
      );

    // Fetch company compliance settings
    const settings = await getComplianceSettings(db, req.user.companyId);

    // Build PDF data
    const origin = req.get('origin') || (req.get('referer') ? new URL(req.get('referer')).origin : '');
    const verifyUrl = `${origin}/compliance/verify?wcn=${encodeURIComponent(co.wcn_number)}`;

    const pdfData = {
      wcn: {
        wcn_number: co.wcn_number,
        wcn_date: co.wcn_date,
        scheduledDate: co.scheduledDate,
        notes: co.notes,
        rectification_notes: co.rectification_notes,
        finalizedByName: co.finalizedByName
      },
      generator: {
        name: co.supplierName,
        cr: co.supplierCr,
        vat: co.supplierVat,
        contactPerson: co.supplierContact,
        phone: co.supplierPhone,
        email: co.supplierEmail,
        address: co.supplierAddress,
        locationName: co.locationName
      },
      transporter: {
        driverName: co.driverFullName || co.driverName,
        driverId: co.driverCode,
        driverPhone: co.driverPhone,
        vehiclePlate: co.vehiclePlate,
        vehicleType: co.vehicleType,
        vehicleDetails: [co.vehicleMake, co.vehicleModel].filter(Boolean).join(' ')
      },
      receiver: {
        name: settings['company.name'] || (req.user.companyId === 'al-ramrami' ? 'Al Ramrami Trading Enterprises' : 'Pride Muscat International LLC'),
        cr: settings['company.cr_number'] || '',
        vat: settings['company.vat_registration'] || '',
        environmentalPermit: settings['company.environmental_permit_number'] || '',
        treatmentMethod: settings['company.treatment_method'] || 'Collection, Sorting & Transfer',
        signatory: settings['company.authorized_signatory_name'] || ''
      },
      items,
      verifyUrl
    };

    auditLog('WCN_MANIFEST_PDF_DOWNLOADED', req.user.userId, {
      wcnNumber: co.wcn_number,
      collectionOrderId: id
    });

    await renderWcnManifest(res, pdfData);
  } catch (error) {
    logger.error('WCN PDF generation error', { error: error.message, stack: error.stack });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to generate manifest PDF', detail: error.message });
    }
  }
});

// NOTE: Public WCN verify endpoint is in routes/publicCompliance.js (no auth required)

module.exports = router;
