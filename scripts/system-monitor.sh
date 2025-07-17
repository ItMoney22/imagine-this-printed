#!/bin/bash
# System Monitoring Script
# Monitors PostgreSQL, NGINX, and overall system health

LOG_FILE="/var/log/metadev/system-monitor.log"
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
    
    if command -v mail >/dev/null 2>&1; then
        echo "$body" | mail -s "$subject" "$EMAIL_TO"
    fi
}

# Function to check service status
check_service() {
    local service_name="$1"
    if systemctl is-active --quiet "$service_name"; then
        log_message "✓ $service_name is running"
        return 0
    else
        log_message "✗ $service_name is not running"
        return 1
    fi
}

# Function to check PostgreSQL connection
check_postgresql() {
    if PGPASSWORD="IAmGod1622#" psql -h localhost -p 5432 -U postgres -d imagine_this_printed -c "SELECT 1;" > /dev/null 2>&1; then
        log_message "✓ PostgreSQL connection successful"
        return 0
    else
        log_message "✗ PostgreSQL connection failed"
        return 1
    fi
}

# Function to check disk space
check_disk_space() {
    local threshold=80
    local usage=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    
    if [ "$usage" -lt "$threshold" ]; then
        log_message "✓ Disk usage: ${usage}% (healthy)"
        return 0
    else
        log_message "✗ Disk usage: ${usage}% (warning: above ${threshold}%)"
        return 1
    fi
}

# Function to check memory usage
check_memory() {
    local threshold=90
    local usage=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
    
    if [ "$usage" -lt "$threshold" ]; then
        log_message "✓ Memory usage: ${usage}% (healthy)"
        return 0
    else
        log_message "✗ Memory usage: ${usage}% (warning: above ${threshold}%)"
        return 1
    fi
}

# Function to check backup files
check_backups() {
    local backup_dir="/var/backups/imagine-this-printed"
    local latest_backup=$(find "$backup_dir" -name "*.sql.gz" -mtime -1 | head -1)
    
    if [ -n "$latest_backup" ]; then
        log_message "✓ Recent backup found: $(basename "$latest_backup")"
        return 0
    else
        log_message "✗ No recent backups found (within 24 hours)"
        return 1
    fi
}

# Function to check website response
check_website() {
    local url="$1"
    local response=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
    
    if [ "$response" = "200" ]; then
        log_message "✓ Website $url is responding (HTTP $response)"
        return 0
    else
        log_message "✗ Website $url is not responding properly (HTTP $response)"
        return 1
    fi
}

log_message "=== System Health Check Started ==="

# Initialize counters
failed_checks=0
total_checks=0

# Check services
services=("postgresql" "nginx" "php8.3-fpm" "fail2ban")
for service in "${services[@]}"; do
    total_checks=$((total_checks + 1))
    if ! check_service "$service"; then
        failed_checks=$((failed_checks + 1))
    fi
done

# Check PostgreSQL connection
total_checks=$((total_checks + 1))
if ! check_postgresql; then
    failed_checks=$((failed_checks + 1))
fi

# Check system resources
total_checks=$((total_checks + 1))
if ! check_disk_space; then
    failed_checks=$((failed_checks + 1))
fi

total_checks=$((total_checks + 1))
if ! check_memory; then
    failed_checks=$((failed_checks + 1))
fi

# Check backups
total_checks=$((total_checks + 1))
if ! check_backups; then
    failed_checks=$((failed_checks + 1))
fi

# Check website
total_checks=$((total_checks + 1))
if ! check_website "http://localhost"; then
    failed_checks=$((failed_checks + 1))
fi

# Check Adminer
total_checks=$((total_checks + 1))
if ! check_website "http://adminer.imaginethisprinted.com"; then
    failed_checks=$((failed_checks + 1))
fi

# Log system statistics
log_message "=== System Statistics ==="
log_message "Load Average: $(uptime | awk -F'load average:' '{print $2}')"
log_message "Memory: $(free -h | grep 'Mem:' | awk '{print $3 "/" $2 " (" $7 " available)"}')"
log_message "Disk Usage: $(df -h / | awk 'NR==2 {print $3 "/" $2 " (" $5 " used)"}')"
log_message "Database Size: $(PGPASSWORD="IAmGod1622#" psql -h localhost -p 5432 -U postgres -d imagine_this_printed -t -c "SELECT pg_size_pretty(pg_database_size('imagine_this_printed'));" | xargs)"

# Log recent errors from NGINX
log_message "=== Recent NGINX Errors ==="
if [ -f "/var/log/nginx/error.log" ]; then
    tail -10 /var/log/nginx/error.log | while read line; do
        log_message "NGINX: $line"
    done
else
    log_message "No NGINX error log found"
fi

# Log fail2ban status
log_message "=== Fail2Ban Status ==="
if command -v fail2ban-client >/dev/null 2>&1; then
    fail2ban-client status | while read line; do
        log_message "Fail2Ban: $line"
    done
else
    log_message "Fail2Ban not available"
fi

# Summary
log_message "=== Health Check Summary ==="
log_message "Passed: $((total_checks - failed_checks))/$total_checks checks"

if [ "$failed_checks" -gt 0 ]; then
    log_message "❌ SYSTEM HEALTH: WARNINGS DETECTED"
    send_email "System Health Alert - imaginethisprinted.com" "System health check failed $failed_checks out of $total_checks checks. Check logs at $LOG_FILE"
else
    log_message "✅ SYSTEM HEALTH: ALL CHECKS PASSED"
fi

log_message "=== System Health Check Completed ==="

exit $failed_checks