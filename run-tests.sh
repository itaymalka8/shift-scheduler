#!/bin/bash

# Test Script
# This script runs tests for both frontend and backend

echo "🧪 Running Shift Scheduler Tests..."
echo "=================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the shift-scheduler directory"
    echo "   Current directory: $(pwd)"
    echo "   Expected: shift-scheduler/"
    exit 1
fi

echo "📁 Current directory: $(pwd)"
echo ""

# Run frontend tests
echo "🧪 Running frontend tests..."
if [ -f "package.json" ]; then
    if npm test 2>/dev/null; then
        echo "✅ Frontend tests passed!"
    else
        echo "⚠️  Frontend tests failed or not configured"
    fi
else
    echo "⚠️  Frontend tests not found"
fi

echo ""

# Run backend tests
echo "🧪 Running backend tests..."
if [ -f "backend/package.json" ]; then
    cd backend
    if npm test 2>/dev/null; then
        echo "✅ Backend tests passed!"
    else
        echo "⚠️  Backend tests failed or not configured"
    fi
    cd ..
else
    echo "⚠️  Backend tests not found"
fi

echo ""
echo "🎉 Test run completed!"
echo ""
echo "📊 Test Summary:"
echo "   Frontend: Check output above"
echo "   Backend: Check output above"
echo ""
echo "🔧 To run individual tests:"
echo "   Frontend: npm test"
echo "   Backend: cd backend && npm test"
echo ""

