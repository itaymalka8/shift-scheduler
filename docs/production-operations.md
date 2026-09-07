# תפעול Production (Production Operations)

מסמך זה מסביר בעברית פשוטה מה כל פקודת production עושה, למה היא בטוחה, ומה עוד חסר כדי לבצע פעולות מתקדמות יותר בעתיד.

כל מושג באנגלית מלווה בהסבר קצר בעברית בסוגריים, בפעם הראשונה שהוא מופיע.

## 1. עקרון היסוד: הפרדה מוחלטת בין Local ל-Production

לאפליקציה עצמה (האתר שרץ ב-Render) יש משתנה סביבה בשם `DATABASE_URL` — זה תמיד מצביע על מסד הנתונים שהיא אמורה לעבוד מולו (מקומי בפיתוח, Production ב-Render).

**כל סקריפט production** (כל קובץ תחת `scripts/production/`) **לעולם לא נוגע ב-`DATABASE_URL`**. הוא משתמש אך ורק במשתנה חדש ונפרד:

```
PRODUCTION_DATABASE_URL
```

אם המשתנה הזה לא מוגדר — הסקריפט עוצר מיד ולא עושה כלום. אין "נפילה חזרה" (fallback) ל-`DATABASE_URL` בשום מקרה. זו הגנה מכוונת: אם מישהו ירוץ סקריפט production בטעות בלי להגדיר את המשתנה הנכון, הוא לא "יחליק" בטעות למסד הנתונים המקומי ויחשוב שזו Production, ולא יגרום לשום נזק כי הוא פשוט לא ירוץ.

**חשוב:** לא הוספנו שום ערך אמיתי ל-`.env` או ל-`.env.example`. כדי להריץ סקריפט production, יש להגדיר את המשתנה בעצמכם, זמנית, ב-shell שלכם — למשל:

```bash
PRODUCTION_DATABASE_URL="postgresql://...הכתובת האמיתית..." npm run prod:preflight
```

## 2. Hard Safety Guard (מנגנון בטיחות קשיח)

לפני שכל סקריפט production בכלל מתחבר למסד נתונים כלשהו, הוא בודק:

1. **האם `PRODUCTION_DATABASE_URL` בכלל קיים?** אם לא — עצירה.
2. **האם הכתובת בכלל תקינה?** (יש בה host ושם מסד נתונים) אם לא — עצירה.
3. **האם ה-host הוא `localhost`, `127.0.0.1`, `::1` או `0.0.0.0`?** (כתובות שמצביעות על המחשב המקומי שלכם, לא על Production אמיתי) אם כן — עצירה. זו בדיוק הכתובת שכל `DATABASE_URL` מקומי מצביע עליה, ולכן זו ההגנה החשובה ביותר נגד הרצה בטעות על הסביבה הלא נכונה.

אם כל הבדיקות עוברות, הסקריפט מדפיס:

```
Database: host=ep-xyz.us-east-2.aws.neon.tech name=goalx
```

**לעולם לא** מודפס username, password, או ה-URL המלא. הקוד פשוט לא שומר את הפרטים האלה בשום משתנה שיכול להגיע לפלט (output) — הם לא "מוסתרים", הם פיזית לא נוכחים בתוצאה.

הקובץ שמממש את זה: `src/lib/production/env-guard.ts`.

## 3. Read Only Mode (מצב קריאה בלבד) — ברירת המחדל

**כל הסקריפטים הקיימים היום הם Read Only** — הם רק קוראים נתונים (COUNT, SELECT), ולעולם לא כותבים, מוחקים, או מעדכנים שום דבר.

בעתיד, סקריפט שכן ירצה לשנות משהו ב-Production יצטרך לעמוד בתנאי נוסף: משתנה סביבה בשם

```
PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION
```

חייב להיות **בדיוק** הערך הזה, מילה במילה. אם הוא חסר, או קרוב אבל לא מדויק (למשל `true` או `1`) — הסקריפט יסרב לכתוב. זו הגנה מפני "לחיצה בטעות" — צריך להעתיק את המשפט המלא כדי לאשר במודע ששינוי ב-Production הולך לקרות.

כיום קיימות פקודות כתיבה אמיתיות (`prod:cron:suspend`, `prod:cron:resume`, `prod:deploy:trigger`, `prod:backup:create`, וה-workflow המלא `prod:deploy:safe`) — כולן עוברות דרך אותו מנגנון בדיוק (`src/lib/production/write-guard.ts`). ראו §5, §6 ו-§8.

## 4. הפקודות הקיימות היום

### `npm run prod:preflight` — בדיקת מוכנות (Preflight)

בודק (Read Only בלבד) הכל בבת אחת:

- **Migration** (עדכון מבנה מסד נתונים) — כמה migrations כבר הופעלו ב-Production, האם ה-migration האחרון שהוספנו (`20260901180307_add_season_lifecycle_youth_foundation`) כבר שם.
- **Seasons** (עונות) — כמה עונות יש, כמה מהן Active (פעילה), ובעיקר: **האם יש יותר מעונה אחת Active לאותה מדינה בו-זמנית** — זה מצב שאסור שיקרה, כי הוא יתנגש עם חוק במסד הנתונים.
- **מספרים כלליים** — Divisions (ליגות), Teams (קבוצות), Players (שחקנים), Fixtures (משחקים), ועוד.
- **מבנה הליגה** (League Structure) — כמה קבוצות בכל Division, כמה משחקים, והאם זה תואם למה שצפוי (Double Round Robin — בעברית: כל קבוצה משחקת נגד כל קבוצה אחרת פעמיים, פעם בבית ופעם בחוץ).
- **לוח משחקים** — מתי המשחק המוקדם ביותר, מתי המאוחר ביותר, וכמה משחקים "Due" (הגיע זמנם ועדיין לא שוחקו) כרגע.
- **שאריות QA** (QA Residue) — בודק אם נשארו משחקי בדיקה (matchday=999999) שהיו אמורים להימחק.

בסוף מדפיס שורה ברורה: `PRODUCTION PREFLIGHT: PASS` או `PRODUCTION PREFLIGHT: FAIL`.

### `npm run prod:season-status` — מצב העונה (Season Status)

תמונת מצב קצרה וממוקדת: מה העונה הפעילה עכשיו, מה הסיבוב הנוכחי (Round — ג'ורנדה, כלומר איזה מחזור משחקים), אילו משחקים הבאים בתור, כמה משחקים "Due", כמה כבר שוחקו, באיזה שלב Offseason (בין-עונתי) העונה נמצאת אם בכלל, וכמה בקשות Youth Intake (קליטת נוער — כשמועדון בוחר שחקני נוער חדשים) עדיין פתוחות — הן אצל שחקנים אנושיים והן אצל בוטים (מועדוני מחשב).

### `npm run prod:scheduled-check` — בדיקה יבשה של המשימה המתוזמנת (Scheduled Dry Check)

**הפקודה הזאת לא מריצה שום דבר בפועל** — היא רק מחשבת ומדווחת: "אם ה-Cron (משימה מתוזמנת שרצה כל 2 דקות) היה רץ עכשיו, מה היה קורה?"

- כמה משחקים היו מסומלצים (processed).
- כמה Transfer Listings (הצעות מכירה בשוק ההעברות) היו פגות תוקף.
- אילו עונות היו נבדקות.
- האם מעבר עונה (Season Transition — כשעונה נגמרת ועוברים לעונה הבאה) היה אפשרי כרגע.

שימושי לפני Deploy (פריסה — העלאת גרסה חדשה לאוויר): לדעת מראש בדיוק מה יקרה ברגע שהקוד החדש יעלה ו-Cron ירוץ שוב.

### `npm run prod:post-deploy-check` — בדיקה אחרי פריסה (Post-Deploy Check)

מיועד לריצה **מיד אחרי** Deploy, כדי לוודא שהכל נחת כמו שצריך:

- מסד הנתונים בכלל נגיש (Reachable).
- ה-migration הנדרש אכן הופעל (ולא נכשל / לא בוצע Rollback — חזרה אחורה).
- השדות והטבלאות החדשים (Season.status, Season.offseasonStage, YouthIntake, YouthProspect, PlayerSeasonLifecycle) קיימים בפועל.
- אין שתי עונות Active לאותה מדינה.
- מספר המשחקים הכולל תואם ל-1140 (המספר הצפוי ל-V1: 3 דיוויזיות × 20 קבוצות, Double Round Robin).
- אין שאריות QA (matchday=999999).

## 5. Render integration (ממומש)

בניגוד לגרסה הקודמת של המסמך הזה — האינטגרציה עם Render **ממומשת בפועל**, לא רק מתוכננת. היא פשוט לא נבדקה עדיין מול חשבון אמיתי, כי `RENDER_API_KEY` לא הוגדר בסביבה הזו (ראו §7 למטה).

משתני סביבה:
```
RENDER_API_KEY              (חובה לכל פקודת Render)
RENDER_WEB_SERVICE_ID       (אופציונלי — override; ברירת המחדל היא Discovery לפי שם)
RENDER_CRON_SERVICE_ID      (אופציונלי — override; ברירת המחדל היא Discovery לפי שם)
```

**Discovery (גילוי אוטומטי):** לא צריך להזין Service ID בעצמכם. המערכת מוצאת את השירותים לפי השם המדויק שלהם ב-`render.yaml` (`goalx-manager` ו-`goalx-manager-fixture-processor`). אם יש סיבה טובה לעקוף את זה (למשל שני שירותים עם אותו שם בחשבונות שונים), אפשר להגדיר את משתני ה-override.

פקודות זמינות:
- **`npm run prod:render:status`** — Read Only. מצב שירות האתר (Web Service): Suspended או לא, ה-Deploy האחרון, ה-Commit. מצב ה-Cron: Suspended או לא, ה-Schedule (לוח הזמנים), ה-Command (הפקודה שהוא מריץ), הרצה אחרונה.
- **`npm run prod:cron:suspend`** — **פעולת כתיבה.** משהה את ה-Cron. דורש `PRODUCTION_WRITE_CONFIRM`.
- **`npm run prod:cron:resume`** — **פעולת כתיבה.** מחזיר את ה-Cron לפעולה. דורש `PRODUCTION_WRITE_CONFIRM`.
- **`npm run prod:deploy:trigger`** — **פעולת כתיבה.** מפעיל Deploy חדש לשירות האתר (מה-branch המחובר כרגע). דורש `PRODUCTION_WRITE_CONFIRM`. **לא מחכה** לסיום — לזה קיים `prod:deploy:safe` (ראו §9).

**מגבלה שדווחה, לא הומצאה (Limitation):** אין כאן פקודה ל"הרץ את ה-Cron עכשיו, מחוץ ללוח הזמנים שלו". ל-Render אין נקודת קצה (endpoint) מתועדת ויציבה ל-API לפעולה כזו על שירות מסוג Cron Job. במקום להמציא כזו נקודת קצה שעלולה לא לעבוד כמצופה, זה פשוט לא נבנה — הפעולה הכי קרובה שקיימת היא `prod:deploy:trigger` על שירות האתר, שזו פעולה אחרת לגמרי.

**הערת כנות טכנית:** צורת הנתונים שחוזרת מ-Render's API (למשל איך בדיוק מסומן "Suspended") נבנתה לפי התיעוד הרשמי של Render, אך **לא אומתה מול קריאה חיה** (אין עדיין `RENDER_API_KEY` בסביבה הזו). הקוד נכתב "בזהירות הגנתית" — אם צורת הנתונים לא כמצופה, הוא מחזיר "unknown" ולא מנחש. ההרצה האמיתית הראשונה של `prod:render:status` היא גם האימות הראשון.

## 6. Neon integration (ממומש)

גם כאן — ממומש בפועל, לא רק מתוכנן.

משתני סביבה:
```
NEON_API_KEY                 (חובה)
NEON_PROJECT_ID              (אופציונלי — מתגלה אוטומטית אם יש פרויקט Neon יחיד בחשבון)
NEON_PRODUCTION_BRANCH_ID    (אופציונלי — מתגלה אוטומטית: branch שמסומן Primary, או בשם "production"/"main")
```

**Discovery בטוח:** אם יש יותר מפרויקט אחד, או יותר מ-branch "ראשי" אחד — המערכת **מסרבת לנחש** ומבקשת להגדיר את המשתנה המפורש. עדיף לעצור ולשאול מאשר לגבות (Backup) את המקום הלא נכון.

Branch ב-Neon הוא תמיד עותק מלא (Copy-on-Write) של **גם הנתונים וגם המבנה (Schema)** — אין אפשרות ל-"Schema בלבד", כך שהדרישה "לא schema בלבד" מתקיימת אוטומטית בכל Branch שנוצר.

פקודות זמינות:
- **`npm run prod:backup:list`** — Read Only. רשימת כל ה-Branches, מי מהם ה-Production, ומי נוצר ממנו.
- **`npm run prod:backup:create`** — **פעולת כתיבה.** יוצר Branch חדש מה-Production branch, בשם אוטומטי בפורמט `pre-deploy-goalx-YYYY-MM-DD-HHmm` (בשעון UTC, כדי שלא יהיה תלוי באזור זמן). דורש `PRODUCTION_WRITE_CONFIRM`. מיד אחרי היצירה, מריץ אימות (Verify) שה-Branch באמת קיים והוא באמת "ילד" (Child) של ה-Production branch.

**אין פקודת מחיקה (Delete) בכלל, במכוון.** גם לא לגיבויים ישנים. זו החלטה מכוונת — מחיקת Backup היא החלטה אנושית, לא פקודת npm.

## 7. Credential Discovery (§1 — audit הסביבה)

בדיקה אוטומטית (Read Only, לא מדפיסה ערכים) של מה קיים בסביבה הנוכחית:

| משתנה | סטטוס בסביבה זו |
|---|---|
| `RENDER_API_KEY` | MISSING |
| `PRODUCTION_DATABASE_URL` | MISSING |
| `NEON_API_KEY` | MISSING |
| `NEON_PROJECT_ID` | MISSING |
| `NEON_PRODUCTION_BRANCH_ID` | MISSING |
| GitHub authentication | AVAILABLE (דרך GitHub MCP — לא `gh` CLI, שלא מותקן בסביבה הזו) |
| `curl` / `node` / `tsx` | AVAILABLE |

כל עוד `RENDER_API_KEY`/`NEON_API_KEY`/`PRODUCTION_DATABASE_URL` חסרים, שום פקודת Production לא יכולה לרוץ בפועל — כולן מסרבות מיד ובבירור (ראו §2), לא נכשלות בצורה מבלבלת.

**איפה להוסיף כל אחד:** Environment Variables ברמת ה-Environment ב-claude.ai/code (לא בקוד, לא ב-`.env`, לא בצ'אט) — אותו מנגנון בדיוק שכבר תועד לגבי `RENDER_API_KEY` קודם לכן בשיחה הזו.

## 8. Workflow Orchestration — `prod:deploy:safe`

הפקודה שמממשת את המטרה הסופית: פקודה אחת לכל תהליך ה-Deploy המלא, כולל Backup, השהיית Cron, ואימות בכל שלב.

**סדר הפעולות (עוצר בכשל ראשון, לא ממשיך הלאה):**

| שלב | פעולה | הערה |
|---|---|---|
| A | Preflight (בדיקת מוכנות) | אם FAIL → עצירה, שום דבר אחר לא נוגע |
| B | Render status | קריאה בלבד |
| C | Neon backup create (יצירת גיבוי) | אם נכשל → עצירה, Cron עדיין לא הושהה |
| D | Verify backup exists (אימות גיבוי) | אם לא מאומת → עצירה |
| E | Suspend Cron (השהיית המשימה המתוזמנת) | |
| F | Verify Cron suspended | אם לא מאומת → עצירה |
| G | Trigger Web Deploy (הפעלת פריסה) | |
| H | Wait for Deploy (המתנה לסיום, עם Timeout) | אם נכשל/Timeout → עצירה, **Cron נשאר מושהה בכוונה** |
| I | Verify Web is live | אם לא → עצירה, Cron נשאר מושהה |
| J | `prod:post-deploy-check` | אם FAIL → עצירה, Cron נשאר מושהה |
| K | `prod:scheduled-check` (Dry Check — **לא** מריץ fixtures בפועל) | |
| L | Resume Cron | **הצעד היחיד שמחזיר את ה-Cron לפעולה** |
| M | Verify Cron active | אם לא מאומת → עצירה |
| N | Poll הרצת Cron הבאה | LIMITATION מדווחת — ל-Render אין endpoint ליומן הרצות בודדות של Cron |

**חשוב:** אם ה-Deploy עצמו נכשל (שלב H ואילך) — ה-Cron **נשאר מושהה במכוון** ולא חוזר לפעולה אוטומטית. זו החלטה מכוונת: עדיף שמשחקים לא יעובדו מול Deploy שבור, עד שבן אדם בודק ומחליט.

**אישור כתיבה יחיד לכל התהליך:** `PRODUCTION_WRITE_CONFIRM` נבדק פעם בכל שלב כתיבה בתוך אותה הרצה — אבל כיוון שזו הרצת פרוססס אחת עם משתנה סביבה אחד, זה בפועל אישור **יחיד** לכל ה-workflow, לא אישור נפרד לכל שלב.

הרצה:
```bash
PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:deploy:safe
```

**לעולם לא מריץ בעצמו:**
- `npx prisma migrate deploy` — זה כבר קורה אוטומטית בתוך ה-buildCommand של Render כחלק משלב G.
- `process-scheduled-jobs` האמיתי — שלב K הוא Dry Check בלבד.

## 9. Production Ops API — עוקף לגמרי את PRODUCTION_DATABASE_URL

זו התשתית שמאפשרת ל-Claude להריץ preflight/season-status/scheduled-check **בלי אף פעם להחזיק את חיבור ה-Postgres של Production**. ה-DATABASE_URL האמיתי נשאר אך ורק ב-Render, אף פעם לא זז משם.

**איך זה עובד:**
1. Endpoint פנימי חדש: `GET /api/internal/production-ops?check=preflight|season-status|scheduled-check` — רץ **בתוך האפליקציה עצמה**, ב-Production, עם ה-`prisma` (מסד הנתונים) שכבר מחובר שם ממילא. מוגן ב-token (`Authorization: Bearer <token>`), fail-closed (503 אם ה-token לא מוגדר בכלל, 401 אם לא תואם, השוואה timing-safe — אותה תבנית בדיוק כמו `/api/internal/process-fixtures` הקיים).
2. Token בשם `PRODUCTION_OPS_READ_TOKEN` — **נוצר אוטומטית** (ערך אקראי קריפטוגרפי, 256 סיביות) ונשמר **ישירות על Render** דרך Render API (`npm run prod:ops:provision-token`, פעם אחת, אידמפוטנטי). הערך אף פעם לא מודפס, לא נכתב לקובץ, לא נכנס ל-git.
3. הסקריפט שקורא לזה (`npm run prod:ops:preflight` / `prod:ops:season-status` / `prod:ops:scheduled-check`) **שולף את הטוקן חזרה מ-Render** ברגע הריצה עצמה (דרך אותו `RENDER_API_KEY` credential), משתמש בו לקריאת ה-endpoint, ומעולם לא שומר אותו — לא ב-env var של ה-session, לא בדיסק. הוא קיים רק בזיכרון התהליך, לרגע אחד.

**התוצאה:** `PRODUCTION_DATABASE_URL` הופך **מיותר לחלוטין** מבחינת ה-checks האלה — מספיק `RENDER_API_KEY` בלבד.

**בטיחות בכתיבת ה-env var:** `setWebServiceEnvVar` (וממנו `prod:ops:provision-token`) משתמש **רק** בנקודת הקצה של Render לעדכון משתנה יחיד (`PUT .../env-vars/:key`) — **לעולם לא** בנקודת קצה שמחליפה את כל רשימת המשתנים בבת אחת, כדי שאין שום סיכוי (גם לא בטעות) למחוק בטעות DATABASE_URL/NEXTAUTH_SECRET קיימים.

## 10. מה בהחלט אסור, תמיד (אוטומטית)

בשום מצב, אף פקודה כאן לא תבצע לבד:

- Database Restore (שחזור מסד נתונים)
- DELETE / DROP / TRUNCATE על Production
- Force push, או Merge ל-main
- מחיקת Neon Branch, מחיקת Render Service
- Rotate Secret (החלפת מפתח גישה)
- Migration הרסני מכל סוג

אלה תמיד דורשים החלטה אנושית מפורשת, מחוץ לכל סקריפט.

## 11. סיכום פקודות

| פקודה | סוג | דורש |
|---|---|---|
| `prod:ops:provision-token` | כתיבה (חד-פעמי) | `RENDER_API_KEY` + `PRODUCTION_WRITE_CONFIRM` |
| `prod:ops:preflight` | Read Only | `RENDER_API_KEY` בלבד — **לא** `PRODUCTION_DATABASE_URL` |
| `prod:ops:season-status` | Read Only | `RENDER_API_KEY` בלבד |
| `prod:ops:scheduled-check` | Read Only | `RENDER_API_KEY` בלבד |
| `prod:preflight` (הגרסה הישנה, חיבור ישיר) | Read Only | `PRODUCTION_DATABASE_URL` |
| `prod:season-status` (הגרסה הישנה) | Read Only | `PRODUCTION_DATABASE_URL` |
| `prod:scheduled-check` (הגרסה הישנה) | Read Only | `PRODUCTION_DATABASE_URL` |
| `prod:post-deploy-check` | Read Only | `PRODUCTION_DATABASE_URL` |
| `prod:render:status` | Read Only | `RENDER_API_KEY` |
| `prod:backup:list` | Read Only | `NEON_API_KEY` |
| `prod:cron:suspend` | כתיבה | `RENDER_API_KEY` + `PRODUCTION_WRITE_CONFIRM` |
| `prod:cron:resume` | כתיבה | `RENDER_API_KEY` + `PRODUCTION_WRITE_CONFIRM` |
| `prod:deploy:trigger` | כתיבה | `RENDER_API_KEY` + `PRODUCTION_WRITE_CONFIRM` |
| `prod:backup:create` | כתיבה | `NEON_API_KEY` + `PRODUCTION_WRITE_CONFIRM` |
| `prod:deploy:safe` | Workflow (קריאה+כתיבה משולבות) | כל הנ"ל + `PRODUCTION_WRITE_CONFIRM` |

הגרסאות הישנות (`prod:preflight` וכו') נשארות קיימות במכוון — לדיבוג ישיר מול מסד הנתונים כשמישהו מריץ אותן בעצמו עם `PRODUCTION_DATABASE_URL` משלו, מחוץ ל-Claude.
