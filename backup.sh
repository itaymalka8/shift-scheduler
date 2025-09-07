#!/bin/bash

# Backup Script
# This script creates a backup of the application

echo "💾 Creating Shift Scheduler Backup..."
echo "====================================="
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

# Create backup directory
BACKUP_DIR="backup-$(date +%Y%m%d-%H%M%S)"
echo "📁 Creating backup directory: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

# Backup frontend
echo "💾 Backing up frontend..."
if [ -f "package.json" ]; then
    cp package.json "$BACKUP_DIR/"
    cp package-lock.json "$BACKUP_DIR/" 2>/dev/null || true
    cp -r src "$BACKUP_DIR/" 2>/dev/null || true
    cp -r public "$BACKUP_DIR/" 2>/dev/null || true
    cp next.config.ts "$BACKUP_DIR/" 2>/dev/null || true
    cp tailwind.config.ts "$BACKUP_DIR/" 2>/dev/null || true
    cp tsconfig.json "$BACKUP_DIR/" 2>/dev/null || true
    echo "✅ Frontend backed up"
else
    echo "❌ Frontend package.json not found!"
fi

# Backup backend
echo "💾 Backing up backend..."
if [ -f "backend/package.json" ]; then
    cp -r backend "$BACKUP_DIR/"
    echo "✅ Backend backed up"
else
    echo "⚠️  Backend package.json not found!"
fi

# Backup configuration files
echo "💾 Backing up configuration files..."
cp docker-compose.yml "$BACKUP_DIR/" 2>/dev/null || true
cp Dockerfile.frontend "$BACKUP_DIR/" 2>/dev/null || true
cp README.md "$BACKUP_DIR/" 2>/dev/null || true
cp .gitignore "$BACKUP_DIR/" 2>/dev/null || true
cp .dockerignore "$BACKUP_DIR/" 2>/dev/null || true

# Backup scripts
echo "💾 Backing up scripts..."
cp *.sh "$BACKUP_DIR/" 2>/dev/null || true
cp *.bat "$BACKUP_DIR/" 2>/dev/null || true

echo "✅ Configuration files backed up"

# Create backup info file
echo "📝 Creating backup info..."
cat > "$BACKUP_DIR/backup-info.txt" << EOF
Shift Scheduler Backup
=====================
Created: $(date)
Version: $(git describe --tags 2>/dev/null || echo "Unknown")
Branch: $(git branch --show-current 2>/dev/null || echo "Unknown")
Commit: $(git rev-parse HEAD 2>/dev/null || echo "Unknown")

Backup Contents:
- Frontend source code
- Backend source code
- Configuration files
- Scripts
- Documentation

To restore:
1. Copy files back to original locations
2. Run: npm install
3. Run: cd backend && npm install
4. Run: ./setup-database.sh
5. Run: ./start-all.sh
EOF

echo "✅ Backup info created"

# Compress backup
echo "🗜️  Compressing backup..."
if command -v tar &> /dev/null; then
    tar -czf "${BACKUP_DIR}.tar.gz" "$BACKUP_DIR"
    rm -rf "$BACKUP_DIR"
    echo "✅ Backup compressed: ${BACKUP_DIR}.tar.gz"
else
    echo "⚠️  tar not found, backup not compressed"
fi

echo ""
echo "🎉 Backup completed successfully!"
echo ""
echo "📊 Backup Summary:"
echo "   Location: ${BACKUP_DIR}.tar.gz"
echo "   Size: $(du -h "${BACKUP_DIR}.tar.gz" 2>/dev/null | cut -f1 || echo "Unknown")"
echo "   Created: $(date)"
echo ""
echo "🔧 To restore from backup:"
echo "   tar -xzf ${BACKUP_DIR}.tar.gz"
echo "   cp -r ${BACKUP_DIR}/* ."
echo "   npm install"
echo "   cd backend && npm install"
echo ""