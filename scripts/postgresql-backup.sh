#!/bin/bash
# PostgreSQL Auto-Backup Script
# This script creates daily backups of the PostgreSQL database

BACKUP_DIR="/var/backups/imagine-this-printed"
LOG_FILE="/var/log/metadev/postgresql-backup.log"
EMAIL_TO="info@davidtrinidad.com"
DATE=$(date '+%Y-%m-%d')
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Database configuration
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="imagine_this_printed"
DB_USER="postgres"
DB_PASSWORD="IAmGod1622#"

# Backup retention (days)
RETENTION_DAYS=30

# Function to log messages
log_message() {
    echo "[$TIMESTAMP] $1" | tee -a "$LOG_FILE"
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

log_message "=== Starting PostgreSQL Backup ==="

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Check if backup directory is writable
if [[ ! -w "$BACKUP_DIR" ]]; then
    log_message "ERROR: Backup directory $BACKUP_DIR is not writable"
    send_email "PostgreSQL Backup Failed" "Backup directory $BACKUP_DIR is not writable"
    exit 1
fi

# Check PostgreSQL connection
log_message "Testing PostgreSQL connection..."
if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" > /dev/null 2>&1; then
    log_message "ERROR: Cannot connect to PostgreSQL database"
    send_email "PostgreSQL Backup Failed" "Cannot connect to PostgreSQL database $DB_NAME"
    exit 1
fi

log_message "PostgreSQL connection successful"

# Create backup filename
BACKUP_FILE="$BACKUP_DIR/imagine_this_printed_$DATE.sql"
BACKUP_FILE_COMPRESSED="$BACKUP_FILE.gz"

# Create database dump
log_message "Creating database dump..."
export PGPASSWORD="$DB_PASSWORD"
if pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --verbose \
    --clean \
    --no-acl \
    --no-owner \
    --format=plain \
    --file="$BACKUP_FILE" >> "$LOG_FILE" 2>&1; then
    
    log_message "Database dump created successfully: $BACKUP_FILE"
    
    # Compress backup
    log_message "Compressing backup..."
    if gzip "$BACKUP_FILE"; then
        log_message "Backup compressed successfully: $BACKUP_FILE_COMPRESSED"
        
        # Get file size
        BACKUP_SIZE=$(du -h "$BACKUP_FILE_COMPRESSED" | cut -f1)
        log_message "Backup file size: $BACKUP_SIZE"
        
        # Verify backup integrity
        log_message "Verifying backup integrity..."
        if gunzip -t "$BACKUP_FILE_COMPRESSED" 2>/dev/null; then
            log_message "Backup integrity verified successfully"
        else
            log_message "WARNING: Backup integrity check failed"
            send_email "PostgreSQL Backup Warning" "Backup created but integrity check failed for $BACKUP_FILE_COMPRESSED"
        fi
    else
        log_message "WARNING: Backup compression failed"
        send_email "PostgreSQL Backup Warning" "Backup created but compression failed for $BACKUP_FILE"
    fi
else
    log_message "ERROR: Database dump failed"
    send_email "PostgreSQL Backup Failed" "Database dump failed for $DB_NAME. Check logs at $LOG_FILE"
    exit 1
fi

# Clean up old backups
log_message "Cleaning up old backups (keeping last $RETENTION_DAYS days)..."
find "$BACKUP_DIR" -name "imagine_this_printed_*.sql*" -mtime +$RETENTION_DAYS -delete
REMAINING_BACKUPS=$(find "$BACKUP_DIR" -name "imagine_this_printed_*.sql*" | wc -l)
log_message "Remaining backups: $REMAINING_BACKUPS"

# Create schema-only backup for development
SCHEMA_BACKUP="$BACKUP_DIR/schema_only_$DATE.sql"
log_message "Creating schema-only backup..."
if pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --schema-only \
    --no-acl \
    --no-owner \
    --format=plain \
    --file="$SCHEMA_BACKUP" >> "$LOG_FILE" 2>&1; then
    
    log_message "Schema-only backup created: $SCHEMA_BACKUP"
    gzip "$SCHEMA_BACKUP"
else
    log_message "WARNING: Schema-only backup failed"
fi

# Log database statistics
log_message "Database statistics:"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    SELECT 
        schemaname,
        tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
    FROM pg_stat_user_tables 
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
" >> "$LOG_FILE" 2>&1

# Log total database size
DB_SIZE=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT pg_size_pretty(pg_database_size('$DB_NAME'));")
log_message "Total database size: $DB_SIZE"

log_message "=== PostgreSQL Backup Completed Successfully ==="

# Clean up old log files (keep last 30 days)
find /var/log/metadev -name "*.log" -mtime +30 -delete

exit 0