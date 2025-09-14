# Shift Scheduler - מערכת ניהול משמרות

מערכת ניהול משמרות מתקדמת וחכמה למודיעין בילוש שפט.

## תכונות המערכת

- **מסך כניסה אינטראקטיבי** עם אנימציות מתקדמות
- **ניהול משמרות** - סידור עבודה חכם ויעיל
- **ניהול עובדים** - מעקב אחר עובדים ומשמרות
- **ניהול כלי רכב** - מעקב אחר כלי רכב וזמינות
- **דוחות וניתוח** - מעקב וניתוח ביצועים
- **ממשק רספונסיבי** - מותאם לכל הגדלי מסך

## טכנולוגיות

- **Frontend**: Next.js 15, React 19, TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Icons**: Font Awesome
- **Deployment**: Render.com

## פרסום ל-Render.com

### הגדרות הפרסום

המערכת מוכנה לפרסום ב-Render.com עם הקובץ `render.yaml`:

```yaml
services:
  # Frontend Service
  - type: web
    name: shift-scheduler-frontend-6erj
    env: node
    plan: free
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: NEXT_PUBLIC_API_URL
        value: https://shift-scheduler-backend.onrender.com/api
```

### כתובת הפרסום

האפליקציה תפורסם בכתובת:
**https://shift-scheduler-frontend-6erj.onrender.com**

### הוראות פרסום

1. **העלה את הקוד ל-GitHub**
2. **חבר את החשבון ל-Render.com**
3. **בחר "New Web Service"**
4. **בחר את הרפוזיטורי שלך**
5. **Render יזהה אוטומטית את `render.yaml`**
6. **לחץ על "Deploy"**

### משתמשי ברירת מחדל

המערכת כוללת משתמשי ברירת מחדל:
- **Admin**: admin / admin123
- **Manager**: manager / manager123
- **User**: user / user123

## פיתוח מקומי

```bash
# התקנת תלויות
npm install

# הרצה במצב פיתוח
npm run dev

# בנייה לפרסום
npm run build

# הרצה במצב ייצור
npm start
```

## מסך הכניסה האינטראקטיבי

המערכת כוללת מסך כניסה אינטראקטיבי עם:

- **אנימציות מתקדמות** - חלקיקים נעים ואפקטי זוהר
- **עיצוב מודרני** - צבעי כחול כהה ולבן
- **רספונסיבי** - מותאם לכל הגדלי מסך
- **אפקטי hover** - אינטראקטיביות מתקדמת
- **זכויות יוצרים** - "כל הזכויות שמורות לאיתי מלכא"

## נתיבי האפליקציה

- **מסך ראשי**: `/` - מסך הכניסה האינטראקטיבי
- **כניסה**: `/auth/signin` - דף התחברות
- **הרשמה**: `/auth/signup` - דף הרשמה
- **לוח זמנים**: `/schedule` - ניהול משמרות
- **ניהול משתמשים**: `/admin/users` - ניהול משתמשים

## פתרון בעיות

### שגיאת 502 Bad Gateway
אם אתה מקבל שגיאת 502, זה אומר שהשרת לא מצליח להתחיל. הפתרונות:

1. **ודא שהבנייה הצליחה**:
   ```bash
   npm run build
   ```

2. **בדוק את הלוגים ב-Render**:
   - לך לדשבורד של השירות
   - לחץ על "Logs"
   - חפש שגיאות בהפעלה

3. **ודא שהפורט מוגדר נכון**:
   - Render משתמש בפורט דינמי
   - השתמשנו ב-`npx next start` שמזהה אוטומטית את הפורט

### שגיאת 404
אם אתה מקבל שגיאת 404, ודא ש:
1. הקוד הועלה ל-GitHub
2. הבנייה הצליחה ב-Render
3. השירות רץ בהצלחה

### שגיאות בנייה
אם יש שגיאות בנייה:
1. ודא שהקוד עובר `npm run build` מקומית
2. בדוק את הלוגים ב-Render
3. ודא שכל התלויות מותקנות

### הגדרות Render המעודכנות

```yaml
services:
  # Frontend Service
  - type: web
    name: shift-scheduler-frontend-6erj
    env: node
    plan: free
    buildCommand: npm install && npm run build
    startCommand: npx next start
    envVars:
      - key: NODE_ENV
        value: production
      - key: NEXT_PUBLIC_API_URL
        value: https://shift-scheduler-backend.onrender.com/api
```

## תמיכה

לשאלות ותמיכה, פנה לאיתי מלכא.

---

© 2024 כל הזכויות שמורות לאיתי מלכא