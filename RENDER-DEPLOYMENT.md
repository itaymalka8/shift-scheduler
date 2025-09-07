# Shift Scheduler - Render Deployment Guide

## 🚀 פריסה ל-Render

### שלב 1: הכנת Repository

1. העלה את הקוד ל-GitHub repository
2. ודא שכל הקבצים נכללים:
   - `render.yaml` (בתיקייה הראשית)
   - `render-build.sh` (בתיקייה הראשית)
   - `render-start.sh` (בתיקייה הראשית)
   - `backend/render-build.sh`
   - `backend/render-start.sh`

### שלב 2: יצירת שירותים ב-Render

#### 2.1 יצירת בסיס נתונים PostgreSQL
1. היכנס ל-Render Dashboard
2. לחץ על "New +" → "PostgreSQL"
3. בחר "Free" plan
4. שם: `shift-scheduler-db`
5. לחץ "Create Database"

#### 2.2 יצירת Backend Service
1. לחץ על "New +" → "Web Service"
2. חבר את ה-GitHub repository
3. הגדרות:
   - **Name**: `shift-scheduler-backend`
   - **Environment**: `Node`
   - **Build Command**: `cd backend && npm install`
   - **Start Command**: `cd backend && npm start`
   - **Plan**: `Free`

4. **Environment Variables**:
   ```
   NODE_ENV=production
   PORT=10000
   DB_HOST=[from database]
   DB_PORT=[from database]
   DB_NAME=[from database]
   DB_USER=[from database]
   DB_PASSWORD=[from database]
   JWT_SECRET=[generate new]
   JWT_EXPIRES_IN=24h
   FRONTEND_URL=https://shift-scheduler-frontend.onrender.com
   ```

#### 2.3 יצירת Frontend Service
1. לחץ על "New +" → "Web Service"
2. חבר את אותו GitHub repository
3. הגדרות:
   - **Name**: `shift-scheduler-frontend`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: `Free`

4. **Environment Variables**:
   ```
   NODE_ENV=production
   NEXT_PUBLIC_API_URL=https://shift-scheduler-backend.onrender.com/api
   ```

### שלב 3: הגדרת בסיס הנתונים

1. היכנס לבסיס הנתונים ב-Render
2. לחץ על "Connect" → "External Connection"
3. העתק את פרטי החיבור
4. השתמש ב-PgAdmin או כלי אחר לחיבור
5. הרץ את הסקריפטים מ-`backend/database/schema.js`

### שלב 4: בדיקת הפריסה

1. **Backend**: `https://shift-scheduler-backend.onrender.com/api/health`
2. **Frontend**: `https://shift-scheduler-frontend.onrender.com`

### שלב 5: התחברות ראשונית

- **URL**: `https://shift-scheduler-frontend.onrender.com`
- **Username**: `itaymalka8`
- **Password**: `1990`

## 🔧 פתרון בעיות

### בעיות נפוצות:

1. **Build fails**: ודא שכל הקבצים נכללים ב-repository
2. **Database connection**: בדוק את ה-environment variables
3. **CORS errors**: ודא שה-FRONTEND_URL מוגדר נכון
4. **Port issues**: Render משתמש בפורט 10000

### לוגים:
- Backend: Render Dashboard → shift-scheduler-backend → Logs
- Frontend: Render Dashboard → shift-scheduler-frontend → Logs

## 📱 כתובות הפריסה

- **Frontend**: `https://shift-scheduler-frontend.onrender.com`
- **Backend API**: `https://shift-scheduler-backend.onrender.com/api`
- **Health Check**: `https://shift-scheduler-backend.onrender.com/api/health`

## 🎉 סיום

לאחר הפריסה, האפליקציה תהיה זמינה ברשת ותוכל לגשת אליה מכל מקום!
