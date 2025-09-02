# PDM Backend API

Backend API server for the Petroleum Business Management System supporting multi-tenant oil trading and scrap materials businesses.

## Features

- **Multi-tenant Architecture**: Separate databases for Al Ramrami Trading and Pride Muscat International
- **JWT Authentication**: Secure authentication with refresh tokens
- **Role-based Access Control**: 6 user roles with granular permissions
- **Complete REST APIs**: 12+ API modules for business operations
- **Database Management**: MySQL with Knex.js migrations and seeding
- **Audit Logging**: Comprehensive logging with Winston
- **Transaction Management**: ACID-compliant operations for financial data

## API Modules

- Authentication & Authorization
- Customer & Supplier Management  
- Materials & Inventory Management
- Sales Orders & Purchase Orders
- Contract Management with Rate Calculations
- Wastage Tracking & Approval Workflows
- Petty Cash Cards & Expense Management
- Financial Transactions & Reporting
- Automated Backup System

## Quick Start

### Prerequisites
- Node.js 16+
- MySQL 8.0+

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd PDM-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Configure your database settings in `.env`:
```
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_username
DB_PASSWORD=your_password
AL_RAMRAMI_DB=alliehvb_al_ramrami_db
PRIDE_MUSCAT_DB=alliehvb_pride_muscat_db
JWT_SECRET=your-super-secret-jwt-key
REFRESH_TOKEN_SECRET=your-refresh-token-secret
```

5. Initialize databases:
```bash
node create-proper-modular-schemas.js
```

6. Seed sample data:
```bash
npm run seed
```

7. Start the server:
```bash
npm start
```

The API server will be running on `http://localhost:5000`

## Database Architecture

- **Multi-tenant**: Separate databases per company
- **Al Ramrami DB**: 14 tables (customers, contracts, oil business modules)
- **Pride Muscat DB**: 12 tables (suppliers, scrap business modules)
- **Modular Schema**: Company-specific tables based on enabled modules

## User Roles & Permissions

- **Super Admin**: Full system access across all companies
- **Company Admin**: Full access within assigned company
- **Manager**: All modules with approval permissions
- **Sales Staff**: Customer management, sales operations, inventory viewing
- **Purchase Staff**: Purchase operations, inventory updates, wastage management
- **Accounts Staff**: Financial management, reporting, petty cash operations

## API Documentation

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - User logout

### Business Operations
- `/api/customers` - Customer management
- `/api/suppliers` - Supplier management  
- `/api/materials` - Material definitions
- `/api/inventory` - Inventory management
- `/api/sales-orders` - Sales order processing
- `/api/purchase-orders` - Purchase order management
- `/api/contracts` - Contract management with rates
- `/api/wastages` - Wastage tracking and approval
- `/api/petty-cash-cards` - Petty cash card management
- `/api/petty-cash-expenses` - Expense tracking and approval
- `/api/transactions` - Financial transaction records
- `/api/backups` - Automated backup management

## Security Features

- JWT authentication with refresh tokens
- Bcrypt password hashing
- Rate limiting on authentication endpoints
- CORS protection
- Input validation and sanitization
- SQL injection prevention
- XSS protection

## Development

### Database Migrations
```bash
npx knex migrate:latest
```

### Seed Database
```bash
npx knex seed:run
```

### Run Tests
```bash
npm test
```

## Production Deployment

1. Set `NODE_ENV=production` in your environment
2. Configure production database credentials
3. Set secure JWT secrets
4. Use process managers like PM2
5. Set up reverse proxy with Nginx
6. Configure SSL certificates

## License

Proprietary - All rights reserved

## Support

For technical support, please contact the development team.
