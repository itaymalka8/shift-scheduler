#!/usr/bin/env bash
# Render build script for Shift Scheduler

echo "🚀 Starting Render build process..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the application
echo "🔨 Building application..."
npm run build

echo "✅ Build completed successfully!"
