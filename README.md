# מערכת ניהול משמרות מודיעין בילוש שפט
## Shift Scheduler - Intelligence Detective Patrol Management System

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Next.js](https://img.shields.io/badge/Next.js-14.0.0-black.svg)

מערכת מקיפה לניהול משמרות, תכנון עבודה וניהול עובדים עבור יחידות מודיעין בילוש שפט.

## ✨ תכונות עיקריות

### 📋 ניהול משמרות
- לוח זמנים שבועי אינטראקטיבי
- הקצאת עובדים למשמרות (בוקר, צהריים, ערב)
- גרירה ושחרור (Drag & Drop) של עובדים
- תצוגה רספונסיבית למחשב ונייד

### 👥 ניהול עובדים
- רשימת עובדים מלאה עם תפקידים
- הוספה, עריכה ומחיקה של עובדים
- מערכת הרשאות (מנהל, מנהל, משתמש)
- חיפוש והצגת משמרות אישיות

### 📊 תכנון עבודה יומי
- תכנון פעילויות יומיות (נשק, סמים, כספים, וכו')
- הקצאת עובדים למשימות ספציפיות
- תצוגת גאנט לתכנון שבועי
- סיכום וייצוא נתונים

### 🔐 מערכת אימות ואבטחה
- התחברות עם שם משתמש וסיסמה
- מערכת הרשאות מתקדמת
- ניהול משתמשים (למנהלים בלבד)
- זכירת התחברות

### 📱 תאימות פלטפורמות
- תמיכה במחשב, אנדרואיד ו-iOS
- ממשק מותאם לנייד
- תצוגה אופטימלית בכל הגדלים

## 🚀 התקנה מהירה

### דרישות מערכת
- **Node.js** 18.0.0 או גרסה עדכנית יותר
- **npm** 9.0.0 או גרסה עדכנית יותר
- **PostgreSQL** 15.0 או גרסה עדכנית יותר
- **Docker** (אופציונלי, מומלץ לפריסה)

### התקנה ב-Linux/Mac
```bash
# שכפול הפרויקט
git clone <repository-url>
cd shift-scheduler

# התקנה מהירה
./quick-start.sh

# או התקנה ידנית
./install.sh
./setup.sh
```

### התקנה ב-Windows
```cmd
# שכפול הפרויקט
git clone <repository-url>
cd shift-scheduler

# התקנה מהירה
quick-start.bat

# או התקנה ידנית
install.bat
setup.bat
```

## 📱 הפעלת המערכת

### הפעלה רגילה
```bash
# Linux/Mac
./start-all.sh

# Windows
start-all.bat
```

### הפעלה עם Docker
```bash
# Linux/Mac
./start-docker.sh

# Windows
start-docker.bat
```

### כתובות המערכת
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000/api
- **Health Check**: http://localhost:5000/api/health

## 👤 התחברות ראשונית

### מנהל ברירת מחדל
- **שם משתמש**: `itaymalka8`
- **סיסמה**: `1990`
- **הרשאות**: מנהל מלא

## 🛠️ פקודות ניהול

### Linux/Mac
```bash
./status.sh          # בדיקת סטטוס
./logs.sh            # צפייה בלוגים
./monitor.sh         # ניטור המערכת
./stop-all.sh        # עצירת המערכת
./clean.sh           # ניקוי קבצים זמניים
./backup.sh          # גיבוי נתונים
./update.sh          # עדכון המערכת
```

### Windows
```cmd
status.bat          # בדיקת סטטוס
logs.bat            # צפייה בלוגים
monitor.bat         # ניטור המערכת
stop-all.bat        # עצירת המערכת
clean.bat           # ניקוי קבצים זמניים
backup.bat          # גיבוי נתונים
update.bat          # עדכון המערכת
```

## 🏗️ ארכיטקטורה

### Frontend (Next.js + TypeScript)
```
src/
├── app/                 # App Router pages
├── components/          # React components
├── store/              # Zustand state management
├── lib/                # Utilities and helpers
└── styles/             # CSS and styling
```

### Backend (Express.js + PostgreSQL)
```
backend/
├── routes/             # API routes
├── middleware/         # Authentication & validation
├── database/           # Database connection & schema
└── config/             # Configuration files
```

## 🐳 פריסה עם Docker

### Docker Compose
```yaml
# docker-compose.yml מוכן לשימוש
services:
  - frontend (Next.js)
  - backend (Express.js)
  - database (PostgreSQL)
```

### פקודות Docker
```bash
# בניית תמונות
./build.sh

# הפעלה עם Docker
docker-compose up -d

# עצירה
docker-compose down
```

## 🔧 פיתוח

### הפעלת סביבת פיתוח
```bash
# Frontend בלבד
npm run dev

# Backend בלבד
cd backend && npm run dev

# שניהם יחד
./start-all.sh
```

### בדיקות
```bash
# הרצת בדיקות
./run-tests.sh          # Linux/Mac
run-tests.bat           # Windows
```

## 📂 מבנה הפרויקט

```
shift-scheduler/
├── 📁 src/                    # Frontend source code
├── 📁 backend/               # Backend source code
├── 📁 public/                # Static assets
├── 🐳 docker-compose.yml     # Docker configuration
├── 🔧 next.config.ts         # Next.js configuration
├── 📜 package.json           # Frontend dependencies
├── 🚀 *.sh                   # Linux/Mac scripts
├── 🚀 *.bat                  # Windows scripts
└── 📖 README.md              # This file
```

## 🔐 מערכת ההרשאות

### תפקידים
- **admin**: גישה מלאה לכל התכונות
- **manager**: ניהול עובדים ומשמרות
- **user**: צפייה ועריכה בסיסית

### הרשאות ספציפיות
- `manage_users`: ניהול משתמשים
- `manage_employees`: ניהול עובדים
- `manage_vehicles`: ניהול כלי רכב
- `manage_schedule`: ניהול משמרות
- `manage_work_plan`: ניהול תכנון עבודה
- `manage_requests`: ניהול בקשות

## 🚨 פתרון בעיות

### בעיות נפוצות

#### המערכת לא עולה
```bash
# בדיקת סטטוס השירותים
./status.sh

# בדיקת לוגים
./logs.sh

# איפוס המערכת
./reset.sh
```

#### בעיות בסיס נתונים
```bash
# איפוס בסיס הנתונים
./setup-database.sh

# בדיקת חיבור
psql -h localhost -U postgres -d shift_scheduler -c "SELECT 1;"
```

#### בעיות Docker
```bash
# ניקוי Docker
docker system prune -a

# בניה מחדש
./build.sh
```

## 📞 תמיכה

### לקבלת עזרה
```bash
./help.sh           # Linux/Mac
help.bat            # Windows
```

### מידע על המערכת
```bash
./info.sh           # Linux/Mac
info.bat            # Windows
```

## 📄 רישיון

כל הזכויות שמורות לאיתי מלכא - 2024

---

**פותח בהתמחות עבור יחידות מודיעין בילוש שפט**

🔒 **מערכת מאובטחת** | 📱 **תאימות מלאה** | ⚡ **ביצועים גבוהים**