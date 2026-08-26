# Goalx Manager

## משחק ניהול כדורגל מקוון

![Version](https://img.shields.io/badge/version-0.1.0-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Next.js](https://img.shields.io/badge/Next.js-15.5.2-black.svg)

Goalx Manager הוא משחק ניהול כדורגל בסגנון "האטריק" - נרשמים, מקימים קבוצה,
מנהלים סגל שחקנים, קובעים טקטיקה ומתחרים בליגה חיה מול מנהלים אחרים.

## ✨ מצב נוכחי

השלב הראשון של הפיתוח כולל:

- 🎨 מיתוג מלא (לוגו, ערכת צבעים סגולה/לבנה)
- 🔐 הרשמה והתחברות אמיתיות (NextAuth + Prisma)
- 🏟️ הקמת קבוצה בעת ההרשמה
- 📋 מסך בית לאחר התחברות

שלבים הבאים (טרם נבנו): ניהול סגל שחקנים, טקטיקה ותורים, מנוע סימולציית
משחקים, טבלת ליגה ולוח משחקים, שוק העברות וכלכלה.

## 🚀 הרצה מקומית

```bash
npm install
npx prisma migrate dev
npm run dev
```

האפליקציה תעלה בכתובת http://localhost:3000

## ⚙️ משתני סביבה

ראו `.env.example`:

```bash
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="secret-אקראי"
NEXTAUTH_URL="http://localhost:3000"
```

## 🏗️ ארכיטקטורה

```
src/
├── app/                 # Next.js App Router (עמודים ו-API routes)
├── components/          # רכיבי React (כולל shadcn/ui)
├── lib/                 # Prisma client, NextAuth config, ולידציות
└── generated/prisma/    # Prisma Client שנוצר אוטומטית
prisma/
└── schema.prisma        # מודלים: User, Team
```

## 🛠️ טכנולוגיות

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (Radix primitives)
- **Prisma** + **SQLite** (בפיתוח; ניתן לעבור ל-Postgres בפרודקשן)
- **NextAuth.js** (Credentials provider) + **bcryptjs**

## 📄 רישיון

כל הזכויות שמורות לאיתי מלכא
