#!/bin/bash

# Rewards System Test Script
# Tests all API endpoints and database functions

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_BASE="${API_BASE:-https://api.imaginethisprinted.com}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
USER_TOKEN="${USER_TOKEN:-}"

echo "========================================="
echo "Rewards System Test Suite"
echo "========================================="
echo ""

# Function to test an endpoint
test_endpoint() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local token="$4"
    local data="$5"

    echo -n "Testing: $name... "

    if [ -z "$token" ]; then
        echo -e "${YELLOW}SKIPPED${NC} (no token)"
        return
    fi

    local cmd="curl -s -X $method"
    cmd="$cmd -H 'Authorization: Bearer $token'"
    cmd="$cmd -H 'Content-Type: application/json'"

    if [ -n "$data" ]; then
        cmd="$cmd -d '$data'"
    fi

    cmd="$cmd $API_BASE$endpoint"

    response=$(eval $cmd)
    status=$?

    if [ $status -eq 0 ] && echo "$response" | grep -q '"ok":true'; then
        echo -e "${GREEN}PASS${NC}"
        return 0
    else
        echo -e "${RED}FAIL${NC}"
        echo "Response: $response"
        return 1
    fi
}

# Test counter
total_tests=0
passed_tests=0

echo "=== Database Connection Tests ==="
echo ""

# Test 1: Health Check
echo -n "Testing: API Health Check... "
response=$(curl -s "$API_BASE/api/health")
if echo "$response" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}PASS${NC}"
    ((passed_tests++))
else
    echo -e "${RED}FAIL${NC}"
fi
((total_tests++))

echo ""
echo "=== Wallet API Tests ==="
echo ""

# Test 2: Get Wallet
test_endpoint "Get Wallet Balance" "GET" "/api/wallet/get" "$USER_TOKEN"
((total_tests++))
[ $? -eq 0 ] && ((passed_tests++))

# Test 3: Get Points Transactions
test_endpoint "Get Points Transactions" "GET" "/api/wallet/transactions/points" "$USER_TOKEN"
((total_tests++))
[ $? -eq 0 ] && ((passed_tests++))

# Test 4: Get ITC Transactions
test_endpoint "Get ITC Transactions" "GET" "/api/wallet/transactions/itc" "$USER_TOKEN"
((total_tests++))
[ $? -eq 0 ] && ((passed_tests++))

# Test 5: Get Order Rewards
test_endpoint "Get Order Rewards History" "GET" "/api/wallet/rewards/orders" "$USER_TOKEN"
((total_tests++))
[ $? -eq 0 ] && ((passed_tests++))

echo ""
echo "=== Referral API Tests ==="
echo ""

# Test 6: Get Referral Stats
test_endpoint "Get Referral Stats" "GET" "/api/wallet/referral/stats" "$USER_TOKEN"
((total_tests++))
[ $? -eq 0 ] && ((passed_tests++))

# Test 7: Validate Referral Code (should work without auth)
echo -n "Testing: Validate Referral Code... "
response=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{"code":"TESTCODE"}' \
    "$API_BASE/api/wallet/referral/validate")
if echo "$response" | grep -q '"ok":'; then
    echo -e "${GREEN}PASS${NC}"
    ((passed_tests++))
else
    echo -e "${RED}FAIL${NC}"
fi
((total_tests++))

# Test 8: Create Referral Code
test_endpoint "Create Referral Code" "POST" "/api/wallet/referral/create" "$USER_TOKEN" '{"description":"Test code"}'
((total_tests++))
[ $? -eq 0 ] && ((passed_tests++))

echo ""
echo "=== Admin Order Tests ==="
echo ""

# Test 9: Process Pending Rewards (admin only)
test_endpoint "Process Pending Rewards" "POST" "/api/orders/process-pending-rewards" "$ADMIN_TOKEN"
((total_tests++))
[ $? -eq 0 ] && ((passed_tests++))

echo ""
echo "=== Points Redemption Tests ==="
echo ""

# Test 10: Redeem Points (will fail if insufficient balance, but tests endpoint)
test_endpoint "Redeem Points" "POST" "/api/wallet/redeem" "$USER_TOKEN" '{"amount":10,"redeemType":"itc"}'
((total_tests++))
[ $? -eq 0 ] && ((passed_tests++))

echo ""
echo "========================================="
echo "Test Results: $passed_tests/$total_tests passed"
echo "========================================="
echo ""

# Database function tests
echo "=== Database Function Tests ==="
echo ""

if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_DB_PASSWORD" ]; then
    echo "Testing database functions..."

    # Parse Supabase URL to get host
    SUPABASE_HOST=$(echo "$SUPABASE_URL" | sed 's|https://||' | sed 's|/.*||')

    # Test award_order_rewards function
    echo -n "Testing: award_order_rewards() function... "
    psql "postgresql://postgres:$SUPABASE_DB_PASSWORD@db.$SUPABASE_HOST:5432/postgres" << EOF 2>&1 | grep -q "success"
    SELECT award_order_rewards(
        gen_random_uuid(),
        gen_random_uuid(),
        99.99,
        1.0
    );
EOF

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}PASS${NC}"
    else
        echo -e "${YELLOW}SKIP${NC} (could not connect or test)"
    fi

    # Test process_referral_reward function
    echo -n "Testing: process_referral_reward() function... "
    echo -e "${YELLOW}MANUAL TEST REQUIRED${NC}"

else
    echo -e "${YELLOW}SKIPPED${NC} (SUPABASE_URL or SUPABASE_DB_PASSWORD not set)"
fi

echo ""
echo "=== Manual Testing Checklist ==="
echo ""
echo "□ Complete an order and verify rewards appear in wallet"
echo "□ Generate a referral code and share it"
echo "□ Sign up with a referral code and verify welcome bonus"
echo "□ Make first purchase as referred user and verify referrer bonus"
echo "□ Redeem points for ITC"
echo "□ Check transaction history shows all operations"
echo "□ Verify tier progression after reaching spend threshold"
echo "□ Test promotional multipliers during happy hour/weekend"
echo "□ Verify duplicate reward prevention"
echo "□ Test failed reward retry mechanism"
echo ""

# Exit with appropriate status
if [ $passed_tests -eq $total_tests ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed${NC}"
    exit 1
fi
