# Admin Wallet Management System

## Overview

The Admin Wallet Management System provides comprehensive tools for administrators to manage user wallet balances (Points and ITC tokens) with full audit logging and safety features.

## Features

### 1. Admin Authorization
- **Middleware**: `requireAdmin` checks user role before allowing access
- **Location**: `backend/middleware/requireAdmin.ts`
- **Flow**: requireAuth → requireAdmin → endpoint handler

### 2. Wallet Operations

#### Credit Balance
- **Endpoint**: `POST /api/admin/wallet/credit`
- **Purpose**: Add points or ITC to a user's wallet
- **Payload**:
  ```json
  {
    "userId": "uuid",
    "amount": 100,
    "currency": "points",
    "reason": "Customer service compensation for order delay"
  }
  ```

#### Debit Balance
- **Endpoint**: `POST /api/admin/wallet/debit`
- **Purpose**: Remove points or ITC from a user's wallet
- **Payload**:
  ```json
  {
    "userId": "uuid",
    "amount": 50,
    "currency": "itc",
    "reason": "Fraudulent activity reversal",
    "allowNegative": false
  }
  ```

#### Adjust Balance
- **Endpoint**: `POST /api/admin/wallet/adjust`
- **Purpose**: Set a wallet to a specific balance
- **Payload**:
  ```json
  {
    "userId": "uuid",
    "newBalance": 500,
    "currency": "points",
    "reason": "Account reconciliation after data migration"
  }
  ```

#### List User Wallets
- **Endpoint**: `GET /api/admin/wallet/users`
- **Query Params**:
  - `search`: Filter by username or email
  - `limit`: Results per page (default: 50)
  - `offset`: Pagination offset
- **Response**: List of users with wallet balances

#### View Transactions
- **Endpoint**: `GET /api/admin/wallet/transactions`
- **Query Params**:
  - `userId`: Filter by specific user
  - `type`: Filter by transaction type
  - `currency`: Filter by currency (points/itc)
  - `limit`: Results per page (default: 100)
  - `offset`: Pagination offset

### 3. Safety Features

#### Validation
- **Amount validation**: Must be > 0 for credit/debit
- **Reason requirement**: Minimum 10 characters
- **Balance checks**: Prevents negative balances (unless explicitly allowed)
- **Currency validation**: Only 'points' or 'itc' accepted

#### Confirmation Dialog
- Shows summary of action before execution
- Displays balance before/after preview
- Requires explicit confirmation

#### Balance Preview
- Real-time calculation of new balance
- Shows difference (increase/decrease)
- Color-coded: green for credit, red for debit

### 4. Audit Logging

#### Comprehensive Logging
- **Logger**: `backend/utils/wallet-logger.ts`
- **Features**:
  - Structured logging with Pino
  - Sanitized user IDs for security
  - Metadata tracking
  - Error logging with stack traces

#### Transaction Records
- **Table**: `wallet_transactions`
- **Fields**:
  - `user_id`: Target user
  - `type`: Transaction type (admin_credit, admin_debit, admin_adjust, etc.)
  - `currency`: points or itc
  - `amount`: Transaction amount
  - `balance_before`: Balance before transaction
  - `balance_after`: Balance after transaction
  - `reason`: Admin-provided reason
  - `admin_id`: Admin who performed action
  - `metadata`: Additional context (JSON)
  - `created_at`: Timestamp

#### Row Level Security
- Users can view their own transactions
- Admins can view all transactions
- System can insert via service role

## Frontend UI

### AdminWalletManagement Component
- **Location**: `src/components/AdminWalletManagement.tsx`
- **Features**:
  - User search by username/email
  - Sortable table with wallet balances
  - Action buttons: Credit (+), Debit (-), Adjust (✎)
  - Real-time balance preview
  - Confirmation dialogs
  - Success/error notifications

### Admin Dashboard Integration
- **Tab**: "Wallet" in admin dashboard
- **Quick Action**: "Manage Wallets" button on overview tab
- **Navigation**: Accessible to admin users only

## Database Schema

### wallet_transactions Table
```sql
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  type TEXT NOT NULL CHECK (type IN (
    'admin_credit',
    'admin_debit',
    'admin_adjust',
    'redeem',
    'purchase',
    'reward',
    'order_refund',
    'signup_bonus'
  )),
  currency TEXT NOT NULL CHECK (currency IN ('points', 'itc')),
  amount DECIMAL(10, 2) NOT NULL,
  balance_before DECIMAL(10, 2) NOT NULL,
  balance_after DECIMAL(10, 2) NOT NULL,
  reason TEXT NOT NULL,
  admin_id UUID REFERENCES auth.users(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Indexes
- `idx_wallet_transactions_user_id`
- `idx_wallet_transactions_type`
- `idx_wallet_transactions_currency`
- `idx_wallet_transactions_admin_id`
- `idx_wallet_transactions_created_at`

## Usage Examples

### Credit Points to User
```bash
curl -X POST https://api.imaginethisprinted.com/api/admin/wallet/credit \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "123e4567-e89b-12d3-a456-426614174000",
    "amount": 500,
    "currency": "points",
    "reason": "Welcome bonus for new premium customer"
  }'
```

### Debit ITC from User
```bash
curl -X POST https://api.imaginethisprinted.com/api/admin/wallet/debit \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "123e4567-e89b-12d3-a456-426614174000",
    "amount": 10.50,
    "currency": "itc",
    "reason": "Refund processing fee for cancelled order",
    "allowNegative": false
  }'
```

### Adjust Balance
```bash
curl -X POST https://api.imaginethisprinted.com/api/admin/wallet/adjust \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "123e4567-e89b-12d3-a456-426614174000",
    "newBalance": 1000,
    "currency": "points",
    "reason": "Manual balance correction after system audit"
  }'
```

### Search Users
```bash
curl -X GET "https://api.imaginethisprinted.com/api/admin/wallet/users?search=john@example.com" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### View Transactions
```bash
curl -X GET "https://api.imaginethisprinted.com/api/admin/wallet/transactions?userId=123e4567-e89b-12d3-a456-426614174000&limit=50" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

## Security Considerations

### Authentication & Authorization
- All endpoints require valid JWT token
- Admin role verified via `requireAdmin` middleware
- User profile role checked against Supabase database

### Data Validation
- Input sanitization on all endpoints
- Type checking for currency and amount
- Minimum reason length enforced
- Balance validation prevents negative balances

### Audit Trail
- All actions logged with admin ID
- Transaction records are immutable
- Timestamps for all operations
- Metadata tracking for additional context

### RLS Policies
- Users see only their transactions
- Admins see all transactions
- Service role required for inserts

## Error Handling

### Common Errors
- `400`: Missing required fields or invalid data
- `401`: Unauthorized (no token or invalid token)
- `403`: Forbidden (not admin)
- `404`: User wallet not found
- `500`: Server error

### Error Response Format
```json
{
  "error": "Error message",
  "detail": "Additional context (in development mode)"
}
```

## Monitoring & Alerts

### Log Monitoring
- Monitor wallet-logger output for unusual activity
- Set up alerts for large transactions
- Track admin action frequency

### Key Metrics
- Total admin credits per day
- Total admin debits per day
- Number of adjust operations
- Failed transaction attempts
- Admin users performing actions

## Deployment

### Prerequisites
1. Run database migration: `migrations/create_wallet_transactions_table.sql`
2. Ensure environment variables are set
3. Deploy backend with admin routes
4. Deploy frontend with admin UI

### Environment Variables
```env
# Backend
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JWT_SECRET=your_jwt_secret

# Frontend
VITE_API_BASE=https://api.imaginethisprinted.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### Verification
1. Login as admin user
2. Navigate to Admin Dashboard → Wallet tab
3. Search for a test user
4. Perform a small credit operation
5. Verify transaction appears in logs
6. Check database for transaction record

## Future Enhancements

### Potential Features
- [ ] Bulk wallet operations (CSV upload)
- [ ] Scheduled wallet adjustments
- [ ] Wallet transaction exports
- [ ] Real-time notifications to users
- [ ] Approval workflow for large transactions
- [ ] Wallet freeze/unfreeze functionality
- [ ] Transaction reversals with tracking
- [ ] Wallet analytics dashboard
- [ ] Custom transaction types
- [ ] Multi-currency support

## Support

For issues or questions:
1. Check server logs: `backend/logs/wallet-service.log`
2. Review database transaction records
3. Verify admin role in user_profiles table
4. Test with curl commands to isolate frontend/backend issues

## References

- Backend Routes: `backend/routes/admin/wallet.ts`
- Middleware: `backend/middleware/requireAdmin.ts`
- Logger: `backend/utils/wallet-logger.ts`
- UI Component: `src/components/AdminWalletManagement.tsx`
- Types: `src/types/index.ts` (WalletTransaction, UserWalletInfo)
- Migration: `migrations/create_wallet_transactions_table.sql`
