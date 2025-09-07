#!/bin/bash
# Render Deployment Helper Script for Linux/Mac
# This script helps prepare the application for Render deployment

echo "🚀 Preparing Shift Scheduler for Render Deployment..."
echo "==================================================="
echo

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the shift-scheduler directory"
    echo "   Current directory: $(pwd)"
    echo "   Expected: shift-scheduler/"
    exit 1
fi

echo "📁 Current directory: $(pwd)"
echo

# Check if Git is initialized
if [ ! -d ".git" ]; then
    echo "📝 Initializing Git repository..."
    git init
    git add .
    git commit -m "Initial commit for Render deployment"
    echo "✅ Git repository initialized"
else
    echo "✅ Git repository already exists"
fi

echo
echo "📋 Render Deployment Checklist:"
echo "================================"
echo "✅ render.yaml - Created"
echo "✅ render-build.sh - Created"
echo "✅ render-start.sh - Created"
echo "✅ backend/render-build.sh - Created"
echo "✅ backend/render-start.sh - Created"
echo "✅ RENDER-DEPLOYMENT.md - Created"
echo

echo "🚀 Next Steps:"
echo "=============="
echo "1. Push your code to GitHub:"
echo "   git remote add origin https://github.com/yourusername/shift-scheduler.git"
echo "   git push -u origin main"
echo
echo "2. Go to https://render.com"
echo "3. Create a new PostgreSQL database"
echo "4. Create a new Web Service for backend"
echo "5. Create a new Web Service for frontend"
echo "6. Follow the instructions in RENDER-DEPLOYMENT.md"
echo

echo "📱 After deployment, your app will be available at:"
echo "   Frontend: https://shift-scheduler-frontend.onrender.com"
echo "   Backend: https://shift-scheduler-backend.onrender.com"
echo

echo "👤 Default login credentials:"
echo "   Username: itaymalka8"
echo "   Password: 1990"
echo

echo "🎉 Happy deploying!"
echo
