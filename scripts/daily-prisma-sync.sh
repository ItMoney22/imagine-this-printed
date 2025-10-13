#!/bin/bash
# Daily Prisma DB Push Script
# This script runs daily to ensure the database schema is in sync with Prisma

SCRIPT_DIR="/var/www/imagine-this-printed"
LOG_FILE="/var/log/metadev/prisma-daily-sync.log"
EMAIL_TO="info@davidtrinidad.com"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# Function to log messages
log_message() {
    echo "[$DATE] $1" | tee -a "$LOG_FILE"
}

# Function to send email notification
send_email() {
    local subject="$1"
    local body="$2"
    
    # Only send email if mail command is available
    if command -v mail >/dev/null 2>&1; then
        echo "$body" | mail -s "$subject" "$EMAIL_TO"
    fi
}

log_message "=== Starting Daily Prisma DB Push ==="

# Change to project directory
cd "$SCRIPT_DIR" || {
    log_message "ERROR: Cannot change to project directory $SCRIPT_DIR"
    send_email "Prisma Sync Failed" "Cannot change to project directory $SCRIPT_DIR"
    exit 1
}

# Check if .env file exists
if [[ ! -f .env ]]; then
    log_message "ERROR: .env file not found"
    send_email "Prisma Sync Failed" ".env file not found in $SCRIPT_DIR"
    exit 1
fi

# Check if package.json exists
if [[ ! -f package.json ]]; then
    log_message "ERROR: package.json not found"
    send_email "Prisma Sync Failed" "package.json not found in $SCRIPT_DIR"
    exit 1
fi

# Check if Prisma schema exists
if [[ ! -f prisma/schema.prisma ]]; then
    log_message "ERROR: Prisma schema not found"
    send_email "Prisma Sync Failed" "Prisma schema not found in $SCRIPT_DIR/prisma/"
    exit 1
fi

# Check PostgreSQL connection
log_message "Checking PostgreSQL connection..."
if ! PGPASSWORD="IAmGod1622#" psql -h localhost -p 5432 -U postgres -d imagine_this_printed -c "SELECT 1;" > /dev/null 2>&1; then
    log_message "ERROR: Cannot connect to PostgreSQL database"
    send_email "Prisma Sync Failed" "Cannot connect to PostgreSQL database"
    exit 1
fi

log_message "PostgreSQL connection successful"

# Run Prisma DB Push
log_message "Running Prisma DB Push..."
if npx prisma db push --accept-data-loss >> "$LOG_FILE" 2>&1; then
    log_message "Prisma DB Push completed successfully"
    
    # Generate Prisma Client
    log_message "Generating Prisma Client..."
    if npx prisma generate >> "$LOG_FILE" 2>&1; then
        log_message "Prisma Client generated successfully"
    else
        log_message "WARNING: Prisma Client generation failed"
        send_email "Prisma Sync Warning" "Prisma DB Push succeeded but Client generation failed"
    fi
else
    log_message "ERROR: Prisma DB Push failed"
    send_email "Prisma Sync Failed" "Prisma DB Push failed. Check logs at $LOG_FILE"
    exit 1
fi

# Log database statistics
log_message "Database statistics:"
PGPASSWORD="IAmGod1622#" psql -h localhost -p 5432 -U postgres -d imagine_this_printed -c "
    SELECT 
        schemaname,
        tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes
    FROM pg_stat_user_tables 
    ORDER BY schemaname, tablename;
" >> "$LOG_FILE" 2>&1

log_message "=== Daily Prisma DB Push Completed Successfully ==="

# Clean up old log files (keep last 30 days)
find /var/log/metadev -name "*.log" -mtime +30 -delete

exit 0