#!/bin/bash
echo "🔄 Pulling latest changes..."
git pull

echo "🚀 Restarting PM2 applications..."
pm2 restart ecosystem.config.cjs
