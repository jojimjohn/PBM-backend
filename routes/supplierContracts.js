const express = require('express');
const { validate, validateParams, sanitize } = require('../middleware/validation');
const { requirePermission } = require('../middleware/auth');
const { logger, auditLog } = require('../utils/logger');
const { getDbConnection } = require('../config/database');
const Joi = require('joi');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitize);

// GET /api/supplier-contracts/:supplierId/rates - Get active contract rates for supplier
router.get('/:supplierId/rates', 
  validateParams(Joi.object({ supplierId: Joi.number().integer().positive().required() })),
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    try {
      const { supplierId } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get active contracts for the supplier
      const activeContracts = await db('contracts')
        .leftJoin('suppliers', 'contracts.supplierId', 'suppliers.id')
        .select(
          'contracts.id',
          'contracts.contractNumber',
          'contracts.startDate',
          'contracts.endDate',
          'contracts.status',
          'suppliers.name as supplierName'
        )
        .where('contracts.supplierId', supplierId)
        .where('contracts.status', 'active')
        .where('contracts.startDate', '<=', new Date())
        .where('contracts.endDate', '>=', new Date());

      if (activeContracts.length === 0) {
        return res.json({
          success: true,
          data: {
            hasActiveContract: false,
            contracts: [],
            rates: []
          }
        });
      }

      // Get contract rates for all active contracts
      const contractIds = activeContracts.map(c => c.id);
      const contractRates = await db('contract_rates')
        .leftJoin('materials', 'contract_rates.materialId', 'materials.id')
        .leftJoin('contracts', 'contract_rates.contractId', 'contracts.id')
        .select(
          'contract_rates.*',
          'materials.name as materialName',
          'materials.code as materialCode',
          'materials.standardPrice',
          'materials.unit',
          'contracts.contractNumber',
          'contracts.endDate as contractEndDate'
        )
        .whereIn('contract_rates.contractId', contractIds)
        .where('contract_rates.isActive', true)
        .orderBy('materials.name');

      // Calculate savings for each rate
      const ratesWithSavings = contractRates.map(rate => {
        let effectivePrice = rate.standardPrice;
        let savings = 0;
        let savingsPercentage = 0;

        switch (rate.rateType) {
          case 'fixed_rate':
            effectivePrice = rate.contractRate;
            savings = rate.standardPrice - rate.contractRate;
            savingsPercentage = rate.standardPrice > 0 ? (savings / rate.standardPrice) * 100 : 0;
            break;
          
          case 'discount_percentage':
            effectivePrice = rate.standardPrice * (1 - rate.discountPercentage / 100);
            savings = rate.standardPrice - effectivePrice;
            savingsPercentage = rate.discountPercentage;
            break;
          
          case 'minimum_price_guarantee':
            effectivePrice = Math.min(rate.standardPrice, rate.contractRate);
            savings = rate.standardPrice - effectivePrice;
            savingsPercentage = rate.standardPrice > 0 ? (savings / rate.standardPrice) * 100 : 0;
            break;
        }

        return {
          ...rate,
          effectivePrice: parseFloat(effectivePrice.toFixed(3)),
          savings: parseFloat(savings.toFixed(3)),
          savingsPercentage: parseFloat(savingsPercentage.toFixed(2)),
          isExpiringSoon: new Date(rate.contractEndDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
        };
      });

      auditLog('SUPPLIER_CONTRACT_RATES_VIEWED', req.user.userId, {
        supplierId,
        contractCount: activeContracts.length,
        rateCount: ratesWithSavings.length
      });

      res.json({
        success: true,
        data: {
          hasActiveContract: true,
          contracts: activeContracts,
          rates: ratesWithSavings,
          summary: {
            totalContracts: activeContracts.length,
            totalRates: ratesWithSavings.length,
            expiringSoon: ratesWithSavings.filter(r => r.isExpiringSoon).length
          }
        }
      });

    } catch (error) {
      logger.error('Error fetching supplier contract rates', { 
        error: error.message, 
        supplierId: req.params.supplierId,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch supplier contract rates'
      });
    }
  }
);

// GET /api/supplier-contracts/:supplierId/materials/:materialId/rate - Get specific material rate
router.get('/:supplierId/materials/:materialId/rate',
  validateParams(Joi.object({ 
    supplierId: Joi.number().integer().positive().required(),
    materialId: Joi.number().integer().positive().required()
  })),
  requirePermission('VIEW_PURCHASE'),
  async (req, res) => {
    try {
      const { supplierId, materialId } = req.params;
      const { companyId } = req.user;
      const db = getDbConnection(companyId);

      // Get material standard price
      const material = await db('materials')
        .select('standardPrice', 'name', 'code', 'unit')
        .where('id', materialId)
        .where('isActive', true)
        .first();

      if (!material) {
        return res.status(404).json({
          success: false,
          error: 'Material not found'
        });
      }

      // Get active contract rate for this material and supplier
      const contractRate = await db('contract_rates')
        .leftJoin('contracts', 'contract_rates.contractId', 'contracts.id')
        .select(
          'contract_rates.*',
          'contracts.contractNumber',
          'contracts.endDate as contractEndDate'
        )
        .where('contracts.supplierId', supplierId)
        .where('contract_rates.materialId', materialId)
        .where('contracts.status', 'active')
        .where('contracts.startDate', '<=', new Date())
        .where('contracts.endDate', '>=', new Date())
        .where('contract_rates.isActive', true)
        .first();

      if (!contractRate) {
        return res.json({
          success: true,
          data: {
            hasContractRate: false,
            standardPrice: material.standardPrice,
            effectivePrice: material.standardPrice,
            material
          }
        });
      }

      // Calculate effective price based on contract type
      let effectivePrice = material.standardPrice;
      let savings = 0;
      let savingsPercentage = 0;

      switch (contractRate.rateType) {
        case 'fixed_rate':
          effectivePrice = contractRate.contractRate;
          savings = material.standardPrice - contractRate.contractRate;
          savingsPercentage = material.standardPrice > 0 ? (savings / material.standardPrice) * 100 : 0;
          break;
        
        case 'discount_percentage':
          effectivePrice = material.standardPrice * (1 - contractRate.discountPercentage / 100);
          savings = material.standardPrice - effectivePrice;
          savingsPercentage = contractRate.discountPercentage;
          break;
        
        case 'minimum_price_guarantee':
          effectivePrice = Math.min(material.standardPrice, contractRate.contractRate);
          savings = material.standardPrice - effectivePrice;
          savingsPercentage = material.standardPrice > 0 ? (savings / material.standardPrice) * 100 : 0;
          break;
      }

      res.json({
        success: true,
        data: {
          hasContractRate: true,
          standardPrice: material.standardPrice,
          effectivePrice: parseFloat(effectivePrice.toFixed(3)),
          savings: parseFloat(savings.toFixed(3)),
          savingsPercentage: parseFloat(savingsPercentage.toFixed(2)),
          contractRate,
          material,
          isExpiringSoon: new Date(contractRate.contractEndDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

    } catch (error) {
      logger.error('Error fetching material contract rate', { 
        error: error.message, 
        supplierId: req.params.supplierId,
        materialId: req.params.materialId,
        userId: req.user.userId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch material contract rate'
      });
    }
  }
);

module.exports = router;