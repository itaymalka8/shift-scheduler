@echo off
REM Help Script for Windows
REM This script shows help information for all available commands

echo 📚 Shift Scheduler - Help & Commands
echo ====================================
echo.

echo 🚀 Quick Start Commands:
echo ========================
echo   quick-start.bat          - Interactive setup guide
echo   start-all.bat            - Start both frontend and backend
echo   start-docker.bat         - Start with Docker
echo   setup-database.bat       - Setup PostgreSQL database
echo.

echo 🔧 Individual Service Commands:
echo ===============================
echo   start-frontend.bat       - Start frontend only
echo   backend\start.bat         - Start backend only
echo   run-tests.bat            - Run all tests
echo   build.bat                - Build for production
echo   clean.bat                - Clean build artifacts
echo   status.bat               - Check service status
echo.

echo 🐳 Docker Commands:
echo ===================
echo   start-docker.bat         - Start with Docker
echo   deploy.bat               - Full Docker deployment
echo   docker-compose up -d      - Start services
echo   docker-compose down       - Stop services
echo   docker-compose logs -f    - View logs
echo   docker-compose ps         - Check status
echo.

echo 📱 Application URLs:
echo ===================
echo   Frontend:     http://localhost:3000
echo   Backend API:  http://localhost:5000/api
echo   Health Check: http://localhost:5000/api/health
echo.

echo 👤 Default Admin Login:
echo =======================
echo   Username: itaymalka8
echo   Password: 1990
echo.

echo 🗄️  Database Information:
echo ========================
echo   Host:     localhost
echo   Port:     5432
echo   Database: shift_scheduler
echo   Username: postgres
echo   Password: (your PostgreSQL password)
echo.

echo 🔧 Development Commands:
echo ========================
echo   npm run dev               - Start frontend development
echo   cd backend && npm run dev - Start backend development
echo   npm install               - Install frontend dependencies
echo   cd backend && npm install - Install backend dependencies
echo.

echo 📊 Production Commands:
echo =======================
echo   npm run build             - Build frontend for production
echo   npm start                 - Start frontend in production
echo   cd backend && npm start    - Start backend in production
echo.

echo 🧪 Testing Commands:
echo ====================
echo   npm test                  - Run frontend tests
echo   cd backend && npm test     - Run backend tests
echo   run-tests.bat             - Run all tests
echo.

echo 🧹 Cleanup Commands:
echo ====================
echo   clean.bat                 - Clean all build artifacts
echo   rmdir /s /q node_modules  - Remove frontend dependencies
echo   rmdir /s /q backend\node_modules - Remove backend dependencies
echo   docker system prune -f    - Clean Docker system
echo.

echo 📚 Documentation:
echo =================
echo   README.md                 - Main documentation
echo   backend\README.md         - Backend documentation
echo   package.json              - Frontend dependencies
echo   backend\package.json      - Backend dependencies
echo.

echo 🆘 Troubleshooting:
echo ===================
echo   status.bat                - Check all service status
echo   setup-database.bat        - Setup database
echo   clean.bat                 - Clean and reinstall
echo   docker-compose logs -f    - View Docker logs
echo.

echo 📞 Support:
echo ===========
echo   Email: itaymalka8@gmail.com
echo   GitHub: Create an issue
echo.

echo 🎉 Happy coding!
echo.
pause

