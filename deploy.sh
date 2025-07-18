#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Build the project
echo "Building the project..."
npm run build

# Sync .env file
echo "Syncing .env file..."
if [ -f ".env" ]; then
  cp .env .env.production
else
  echo "Warning: .env file not found. Assuming production environment is already configured."
fi

# Restart the server with pm2
echo "Restarting the server with pm2..."
pm2 restart server-simple.js --name imagine-this-printed || pm2 start server-simple.js --name imagine-this-printed

# Ping the URL to confirm success
echo "Pinging the URL to confirm success..."
curl -s -o /dev/null -w "%{http_code}" https://imaginethisprinted.com | grep -q "200" && echo "Deployment successful!" || echo "Deployment failed!"
