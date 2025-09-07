#!/bin/bash

# Restore Script
# This script restores the application from a backup

echo "🔄 Restoring Shift Scheduler from Backup..."
echo "==========================================="
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

# List available backups
echo "📋 Available backups:"
BACKUP_FILES=$(ls backup-*.tar.gz 2>/dev/null)
if [ -z "$BACKUP_FILES" ]; then
    echo "❌ No backup files found!"
    echo "   Please ensure backup files are in the current directory"
    exit 1
fi

echo "$BACKUP_FILES"
echo ""

# Select backup
echo "🔍 Please select a backup to restore:"
select BACKUP_FILE in $BACKUP_FILES; do
    if [ -n "$BACKUP_FILE" ]; then
        break
    else
        echo "❌ Invalid selection. Please try again."
    fi
done

echo ""
echo "📁 Selected backup: $BACKUP_FILE"
echo ""

# Confirm restore
echo "⚠️  This will restore the application from backup."
echo "   This will overwrite existing files."
echo ""
read -p "Are you sure you want to continue? (y/N): " confirm

if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "❌ Restore cancelled"
    exit 0
fi

echo ""
echo "🔄 Starting restore..."

# Extract backup
echo "📦 Extracting backup..."
if [ -f "$BACKUP_FILE" ]; then
    tar -xzf "$BACKUP_FILE"
    BACKUP_DIR="${BACKUP_FILE%.tar.gz}"
    echo "✅ Backup extracted to: $BACKUP_DIR"
else
    echo "❌ Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Restore files
echo "📁 Restoring files..."
if [ -d "$BACKUP_DIR" ]; then
    # Restore frontend
    if [ -f "$BACKUP_DIR/package.json" ]; then
        cp "$BACKUP_DIR/package.json" .
        cp "$BACKUP_DIR/package-lock.json" . 2>/dev/null || true
        cp -r "$BACKUP_DIR/src" . 2>/dev/null || true
        cp -r "$BACKUP_DIR/public" . 2>/dev/null || true
        cp "$BACKUP_DIR/next.config.ts" . 2>/dev/null || true
        cp "$BACKUP_DIR/tailwind.config.ts" . 2>/dev/null || true
        cp "$BACKUP_DIR/tsconfig.json" . 2>/dev/null || true
        echo "✅ Frontend files restored"
    fi

    # Restore backend
    if [ -d "$BACKUP_DIR/backend" ]; then
        cp -r "$BACKUP_DIR/backend" .
        echo "✅ Backend files restored"
    fi

    # Restore configuration files
    cp "$BACKUP_DIR/docker-compose.yml" . 2>/dev/null || true
    cp "$BACKUP_DIR/Dockerfile.frontend" . 2>/dev/null || true
    cp "$BACKUP_DIR/README.md" . 2>/dev/null || true
    cp "$BACKUP_DIR/.gitignore" . 2>/dev/null || true
    cp "$BACKUP_DIR/.dockerignore" . 2>/dev/null || true

    # Restore scripts
    cp "$BACKUP_DIR"/*.sh . 2>/dev/null || true
    cp "$BACKUP_DIR"/*.bat . 2>/dev/null || true

    echo "✅ Configuration files restored"
else
    echo "❌ Backup directory not found: $BACKUP_DIR"
    exit 1
fi

# Clean up extracted files
echo "🧹 Cleaning up..."
rm -rf "$BACKUP_DIR"
echo "✅ Cleanup completed"

# Reinstall dependencies
echo "📦 Reinstalling dependencies..."

# Frontend
echo "📦 Installing frontend dependencies..."
npm install
echo "✅ Frontend dependencies installed"

# Backend
echo "📦 Installing backend dependencies..."
cd backend
npm install
cd ..
echo "✅ Backend dependencies installed"

echo ""
echo "🎉 Restore completed successfully!"
echo ""
echo "📊 Restore Summary:"
echo "   Backup: $BACKUP_FILE"
echo "   Frontend: Restored and reinstalled"
echo "   Backend: Restored and reinstalled"
echo ""
echo "🚀 To start the application:"
echo "   ./start-all.sh"
echo "   Or: ./start-docker.sh"
echo ""