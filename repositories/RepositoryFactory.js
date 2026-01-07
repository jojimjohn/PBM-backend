const BaseRepository = require('./BaseRepository');
const WastageRepository = require('./WastageRepository');
const TransactionRepository = require('./TransactionRepository');
const ProjectsRepository = require('./ProjectsRepository');
const ExpenseCategoryRepository = require('./ExpenseCategoryRepository');

/**
 * Repository Factory
 * Creates and manages repository instances for different entities
 */
class RepositoryFactory {
  constructor(companyId) {
    this.companyId = companyId;
    this.repositories = new Map();
  }

  /**
   * Get repository instance for a specific entity
   * @param {string} entityName - Entity name
   */
  getRepository(entityName) {
    const key = `${this.companyId}_${entityName}`;
    
    if (this.repositories.has(key)) {
      return this.repositories.get(key);
    }

    let repository;

    // Create specialized repositories for specific entities
    switch (entityName) {
      case 'wastages':
        repository = new WastageRepository(this.companyId);
        break;
      case 'transactions':
        repository = new TransactionRepository(this.companyId);
        break;
      case 'projects':
        repository = new ProjectsRepository(this.companyId);
        break;
      case 'expense_categories':
        repository = new ExpenseCategoryRepository(this.companyId);
        break;
      // Add other specialized repositories here as needed
      default:
        // Use base repository for entities without specialized requirements
        repository = new BaseRepository(entityName, this.companyId);
        break;
    }

    this.repositories.set(key, repository);
    return repository;
  }

  /**
   * Get customers repository
   */
  getCustomersRepository() {
    return this.getRepository('customers');
  }

  /**
   * Get suppliers repository
   */
  getSuppliersRepository() {
    return this.getRepository('suppliers');
  }

  /**
   * Get materials repository
   */
  getMaterialsRepository() {
    return this.getRepository('materials');
  }

  /**
   * Get inventory repository
   */
  getInventoryRepository() {
    return this.getRepository('inventory');
  }

  /**
   * Get contracts repository
   */
  getContractsRepository() {
    return this.getRepository('contracts');
  }

  /**
   * Get sales orders repository
   */
  getSalesOrdersRepository() {
    return this.getRepository('sales_orders');
  }

  /**
   * Get purchase orders repository
   */
  getPurchaseOrdersRepository() {
    return this.getRepository('purchase_orders');
  }

  /**
   * Get wastages repository (specialized)
   */
  getWastagesRepository() {
    return this.getRepository('wastages');
  }

  /**
   * Get petty cash cards repository
   */
  getPettyCashCardsRepository() {
    return this.getRepository('petty_cash_cards');
  }

  /**
   * Get petty cash expenses repository
   */
  getPettyCashExpensesRepository() {
    return this.getRepository('petty_cash_expenses');
  }

  /**
   * Get transactions repository (specialized)
   */
  getTransactionsRepository() {
    return this.getRepository('transactions');
  }

  /**
   * Get projects repository (specialized)
   */
  getProjectsRepository() {
    return this.getRepository('projects');
  }

  /**
   * Get expense categories repository (specialized)
   */
  getExpenseCategoriesRepository() {
    return this.getRepository('expense_categories');
  }

  /**
   * Get users repository
   */
  getUsersRepository() {
    return this.getRepository('users');
  }

  /**
   * Clear all cached repositories
   */
  clearCache() {
    this.repositories.clear();
  }

  /**
   * Get all available repositories for this company
   */
  getAvailableRepositories() {
    return Array.from(this.repositories.keys())
      .filter(key => key.startsWith(`${this.companyId}_`))
      .map(key => key.replace(`${this.companyId}_`, ''));
  }
}

// Create factory instances for each company
const repositoryFactories = new Map();

/**
 * Get repository factory for a company
 * @param {string} companyId - Company ID
 */
function getRepositoryFactory(companyId) {
  if (!repositoryFactories.has(companyId)) {
    repositoryFactories.set(companyId, new RepositoryFactory(companyId));
  }
  return repositoryFactories.get(companyId);
}

module.exports = {
  RepositoryFactory,
  getRepositoryFactory
};