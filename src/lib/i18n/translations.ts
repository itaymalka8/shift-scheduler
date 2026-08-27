export const LOCALES = ["he", "en", "ar"] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "he"

export const LOCALE_DIR: Record<Locale, "rtl" | "ltr"> = {
  he: "rtl",
  en: "ltr",
  ar: "rtl",
}

export const LOCALE_LABEL: Record<Locale, string> = {
  he: "עברית",
  en: "English",
  ar: "العربية",
}

const he = {
  "app.name": "Goalx Manager",

  "landing.tagline":
    "נהלו את קבוצת הכדורגל שלכם, אמנו שחקנים, קבעו טקטיקה והתחרו נגד מנהלים אחרים בליגה חיה",
  "landing.ctaSignup": "הקימו קבוצה עכשיו",
  "landing.ctaSignin": "כניסה למנהלים קיימים",
  "landing.feature1Title": "ניהול סגל",
  "landing.feature1Desc": "בנו את הקבוצה שלכם ואמנו את השחקנים",
  "landing.feature2Title": "טקטיקה",
  "landing.feature2Desc": "קבעו מערך משחק ותורו לפני כל מפגש",
  "landing.feature3Title": "ליגה חיה",
  "landing.feature3Desc": "התחרו נגד מנהלים אמיתיים אחרים",

  "auth.orDivider": "או",
  "auth.continueWithGoogle": "המשיכו עם Google",
  "auth.continueWithApple": "המשיכו עם Apple",
  "auth.fullName": "שם מלא",
  "auth.teamName": "שם הקבוצה",
  "auth.email": "אימייל",
  "auth.password": "סיסמה",
  "auth.confirmPassword": "אימות סיסמה",
  "auth.rememberMeSignin": "זכרו אותי (השארו מחוברים גם אחרי סגירת הדפדפן)",
  "auth.rememberMeSignup": "השאירו אותי מחובר גם אחרי סגירת הדפדפן",

  "signup.title": "הקמת קבוצה חדשה",
  "signup.description": "מלאו את הפרטים כדי להתחיל לנהל את הקבוצה שלכם",
  "signup.next": "המשך לפרטי הקבוצה",
  "signup.back": "חזרה",
  "signup.submit": "סיימו הרשמה",
  "signup.submitting": "יוצר קבוצה...",
  "signup.alreadyHaveTeam": "כבר יש לכם קבוצה?",
  "signup.signInHere": "התחברו כאן",
  "signup.signupFailed": "ההרשמה נכשלה",
  "signup.signupSucceededSigninFailed": "ההרשמה הצליחה אך ההתחברות נכשלה, נסו להתחבר ידנית",

  "signin.title": "התחברות למנהלים",
  "signin.description": "התחברו כדי לנהל את הקבוצה שלכם",
  "signin.submit": "התחברות",
  "signin.submitting": "מתחבר...",
  "signin.noTeamYet": "עדיין אין לכם קבוצה?",
  "signin.createTeamHere": "הקימו קבוצה חדשה",
  "signin.invalidCredentials": "אימייל או סיסמה שגויים",

  "crest.title": "סמל הקבוצה",
  "crest.shape": "צורה",
  "crest.shapeShield": "מגן",
  "crest.shapeCircle": "עיגול",
  "crest.shapeHexagon": "משושה",
  "crest.shapePennant": "דגלון",
  "crest.pattern": "תבנית צבעים",
  "crest.patternSolid": "אחיד",
  "crest.patternSplit": "חצי-חצי",
  "crest.patternStripes": "פסים",
  "crest.primaryColor": "צבע ראשי",
  "crest.secondaryColor": "צבע משני",
  "crest.borderColor": "מסגרת",
  "crest.icon": "אייקון",
  "crest.uploadOwn": "או העלו סמל משלכם (PNG, JPG, WEBP, SVG - עד 2MB)",
  "crest.chooseAnotherFile": "בחרו קובץ אחר",
  "crest.removeFile": "הסירו קובץ",
  "crest.fileTooLarge": "הקובץ גדול מדי (מקסימום 2MB)",
  "crest.fileTypeNotSupported": "סוג קובץ לא נתמך (PNG, JPG, WEBP או SVG)",

  "team.title": "פרטי הקבוצה",
  "team.description": "עוד כמה פרטים לפני שהקבוצה שלכם יוצאת לדרך",
  "team.country": "מדינה",
  "team.countryPlaceholder": "בחרו מדינה",
  "team.stadiumName": "שם האצטדיון",
  "team.crowdStyle": "סגנון הקהל",
  "team.crowdStyleCalm": "קהל רגוע",
  "team.crowdStyleCalmDesc": "פחות תקריות, פחות קנסות - יציבות לאורך זמן",
  "team.crowdStyleUltras": "קהל אולטראס",
  "team.crowdStyleUltrasDesc":
    "דוחף את הקבוצה קדימה ברגעים קשים ומשפר ביצועים, אבל עלול לגרור קנסות מאירועי קהל",

  "dashboard.welcome": "ברוכים הבאים, קבוצת {team}",
  "dashboard.greeting": "שלום {name}, כאן יתנהל ניהול הקבוצה שלכם - הסגל, הטקטיקה והליגה יגיעו בקרוב.",
  "dashboard.comingSoon":
    "ההרשמה וההתחברות שלכם עובדות מצוין. השלב הבא הוא בניית הסגל, מסך הטקטיקה ומנוע הליגה.",
  "dashboard.signOut": "התנתקות",

  "validation.nameMin": "השם חייב להכיל לפחות 2 תווים",
  "validation.teamNameMin": "שם הקבוצה חייב להכיל לפחות 2 תווים",
  "validation.emailInvalid": "כתובת אימייל לא תקינה",
  "validation.passwordMin": "הסיסמה חייבת להכיל לפחות 6 תווים",
  "validation.passwordRequired": "יש להזין סיסמה",
  "validation.passwordMismatch": "הסיסמאות אינן תואמות",
  "validation.countryRequired": "יש לבחור מדינה",
  "validation.stadiumNameMin": "יש להזין שם אצטדיון",

  "error.EMAIL_TAKEN": "כבר קיים חשבון עם כתובת האימייל הזו",
  "error.VALIDATION_ERROR": "נתונים לא תקינים",
  "error.CREST_TOO_LARGE": "קובץ הסמל גדול מדי (מקסימום 2MB)",
  "error.CREST_BAD_TYPE": "סוג קובץ לא נתמך (יש להעלות PNG, JPG, WEBP או SVG)",
  "error.GENERIC": "משהו השתבש, נסו שוב",
}

const en: Record<keyof typeof he, string> = {
  "app.name": "Goalx Manager",

  "landing.tagline":
    "Manage your football club, train players, set tactics, and compete against other managers in a live league",
  "landing.ctaSignup": "Create your club now",
  "landing.ctaSignin": "Sign in as an existing manager",
  "landing.feature1Title": "Squad management",
  "landing.feature1Desc": "Build your club and train your players",
  "landing.feature2Title": "Tactics",
  "landing.feature2Desc": "Set your formation and instructions before every match",
  "landing.feature3Title": "Live league",
  "landing.feature3Desc": "Compete against other real managers",

  "auth.orDivider": "or",
  "auth.continueWithGoogle": "Continue with Google",
  "auth.continueWithApple": "Continue with Apple",
  "auth.fullName": "Full name",
  "auth.teamName": "Club name",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.confirmPassword": "Confirm password",
  "auth.rememberMeSignin": "Remember me (stay signed in after closing the browser)",
  "auth.rememberMeSignup": "Keep me signed in after closing the browser",

  "signup.title": "Create a new club",
  "signup.description": "Fill in your details to start managing your club",
  "signup.next": "Continue to club details",
  "signup.back": "Back",
  "signup.submit": "Finish sign up",
  "signup.submitting": "Creating club...",
  "signup.alreadyHaveTeam": "Already have a club?",
  "signup.signInHere": "Sign in here",
  "signup.signupFailed": "Sign up failed",
  "signup.signupSucceededSigninFailed": "Sign up succeeded but sign in failed, please sign in manually",

  "signin.title": "Manager sign in",
  "signin.description": "Sign in to manage your club",
  "signin.submit": "Sign in",
  "signin.submitting": "Signing in...",
  "signin.noTeamYet": "Don't have a club yet?",
  "signin.createTeamHere": "Create a new club",
  "signin.invalidCredentials": "Invalid email or password",

  "crest.title": "Club crest",
  "crest.shape": "Shape",
  "crest.shapeShield": "Shield",
  "crest.shapeCircle": "Circle",
  "crest.shapeHexagon": "Hexagon",
  "crest.shapePennant": "Pennant",
  "crest.pattern": "Color pattern",
  "crest.patternSolid": "Solid",
  "crest.patternSplit": "Split",
  "crest.patternStripes": "Stripes",
  "crest.primaryColor": "Primary color",
  "crest.secondaryColor": "Secondary color",
  "crest.borderColor": "Trim color",
  "crest.icon": "Icon",
  "crest.uploadOwn": "Or upload your own crest (PNG, JPG, WEBP, SVG - up to 2MB)",
  "crest.chooseAnotherFile": "Choose another file",
  "crest.removeFile": "Remove file",
  "crest.fileTooLarge": "The file is too large (2MB max)",
  "crest.fileTypeNotSupported": "Unsupported file type (PNG, JPG, WEBP or SVG)",

  "team.title": "Club details",
  "team.description": "A few more details before your club kicks off",
  "team.country": "Country",
  "team.countryPlaceholder": "Select a country",
  "team.stadiumName": "Stadium name",
  "team.crowdStyle": "Crowd style",
  "team.crowdStyleCalm": "Calm crowd",
  "team.crowdStyleCalmDesc": "Fewer incidents, fewer fines - steady over time",
  "team.crowdStyleUltras": "Ultras crowd",
  "team.crowdStyleUltrasDesc":
    "Pushes the team forward in tough moments and boosts performance, but can lead to fines from crowd incidents",

  "dashboard.welcome": "Welcome, {team}",
  "dashboard.greeting": "Hi {name}, this is where you'll manage your club - squad, tactics, and the league are coming soon.",
  "dashboard.comingSoon":
    "Your sign up and sign in are working great. Next up: building the squad, tactics screen, and league engine.",
  "dashboard.signOut": "Sign out",

  "validation.nameMin": "Name must be at least 2 characters",
  "validation.teamNameMin": "Club name must be at least 2 characters",
  "validation.emailInvalid": "Invalid email address",
  "validation.passwordMin": "Password must be at least 6 characters",
  "validation.passwordRequired": "Password is required",
  "validation.passwordMismatch": "Passwords do not match",
  "validation.countryRequired": "Please select a country",
  "validation.stadiumNameMin": "Please enter a stadium name",

  "error.EMAIL_TAKEN": "An account with this email already exists",
  "error.VALIDATION_ERROR": "Invalid data",
  "error.CREST_TOO_LARGE": "The crest file is too large (2MB max)",
  "error.CREST_BAD_TYPE": "Unsupported file type (please upload PNG, JPG, WEBP or SVG)",
  "error.GENERIC": "Something went wrong, please try again",
}

const ar: Record<keyof typeof he, string> = {
  "app.name": "Goalx Manager",

  "landing.tagline": "أدر ناديك لكرة القدم، درّب اللاعبين، حدد التكتيكات، ونافس مديرين آخرين في دوري حي",
  "landing.ctaSignup": "أنشئ ناديك الآن",
  "landing.ctaSignin": "الدخول كمدير مسجل",
  "landing.feature1Title": "إدارة التشكيلة",
  "landing.feature1Desc": "ابنِ ناديك ودرّب لاعبيك",
  "landing.feature2Title": "التكتيك",
  "landing.feature2Desc": "حدد التشكيلة والتعليمات قبل كل مباراة",
  "landing.feature3Title": "دوري حي",
  "landing.feature3Desc": "نافس مديرين حقيقيين آخرين",

  "auth.orDivider": "أو",
  "auth.continueWithGoogle": "المتابعة مع Google",
  "auth.continueWithApple": "المتابعة مع Apple",
  "auth.fullName": "الاسم الكامل",
  "auth.teamName": "اسم النادي",
  "auth.email": "البريد الإلكتروني",
  "auth.password": "كلمة المرور",
  "auth.confirmPassword": "تأكيد كلمة المرور",
  "auth.rememberMeSignin": "تذكرني (ابقَ مسجلاً حتى بعد إغلاق المتصفح)",
  "auth.rememberMeSignup": "أبقني مسجلاً حتى بعد إغلاق المتصفح",

  "signup.title": "إنشاء نادٍ جديد",
  "signup.description": "املأ بياناتك لتبدأ بإدارة ناديك",
  "signup.next": "متابعة إلى تفاصيل النادي",
  "signup.back": "رجوع",
  "signup.submit": "إنهاء التسجيل",
  "signup.submitting": "جارٍ إنشاء النادي...",
  "signup.alreadyHaveTeam": "لديك نادٍ بالفعل؟",
  "signup.signInHere": "سجّل الدخول هنا",
  "signup.signupFailed": "فشل التسجيل",
  "signup.signupSucceededSigninFailed": "نجح التسجيل لكن فشل تسجيل الدخول، حاول تسجيل الدخول يدويًا",

  "signin.title": "دخول المدير",
  "signin.description": "سجّل الدخول لإدارة ناديك",
  "signin.submit": "تسجيل الدخول",
  "signin.submitting": "جارٍ تسجيل الدخول...",
  "signin.noTeamYet": "ليس لديك نادٍ بعد؟",
  "signin.createTeamHere": "أنشئ نادياً جديداً",
  "signin.invalidCredentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة",

  "crest.title": "شعار النادي",
  "crest.shape": "الشكل",
  "crest.shapeShield": "درع",
  "crest.shapeCircle": "دائرة",
  "crest.shapeHexagon": "سداسي",
  "crest.shapePennant": "راية",
  "crest.pattern": "نمط الألوان",
  "crest.patternSolid": "لون واحد",
  "crest.patternSplit": "نصفين",
  "crest.patternStripes": "خطوط",
  "crest.primaryColor": "اللون الأساسي",
  "crest.secondaryColor": "اللون الثانوي",
  "crest.borderColor": "لون الإطار",
  "crest.icon": "الأيقونة",
  "crest.uploadOwn": "أو ارفع شعارك الخاص (PNG, JPG, WEBP, SVG - حتى 2 ميغابايت)",
  "crest.chooseAnotherFile": "اختر ملفًا آخر",
  "crest.removeFile": "إزالة الملف",
  "crest.fileTooLarge": "الملف كبير جدًا (الحد الأقصى 2 ميغابايت)",
  "crest.fileTypeNotSupported": "نوع ملف غير مدعوم (PNG أو JPG أو WEBP أو SVG)",

  "team.title": "تفاصيل النادي",
  "team.description": "بضع تفاصيل إضافية قبل أن ينطلق ناديك",
  "team.country": "الدولة",
  "team.countryPlaceholder": "اختر دولة",
  "team.stadiumName": "اسم الملعب",
  "team.crowdStyle": "طابع الجمهور",
  "team.crowdStyleCalm": "جمهور هادئ",
  "team.crowdStyleCalmDesc": "حوادث أقل وغرامات أقل - استقرار على المدى الطويل",
  "team.crowdStyleUltras": "جمهور ألتراس",
  "team.crowdStyleUltrasDesc": "يدفع الفريق في اللحظات الصعبة ويحسّن الأداء، لكنه قد يتسبب بغرامات بسبب أحداث الجمهور",

  "dashboard.welcome": "أهلاً بكم، نادي {team}",
  "dashboard.greeting": "مرحبًا {name}، هنا ستُدار شؤون ناديك - التشكيلة والتكتيك والدوري قريبًا.",
  "dashboard.comingSoon": "التسجيل وتسجيل الدخول يعملان بشكل ممتاز. الخطوة التالية: بناء التشكيلة وشاشة التكتيك ومحرك الدوري.",
  "dashboard.signOut": "تسجيل الخروج",

  "validation.nameMin": "يجب أن يتكون الاسم من حرفين على الأقل",
  "validation.teamNameMin": "يجب أن يتكون اسم النادي من حرفين على الأقل",
  "validation.emailInvalid": "بريد إلكتروني غير صالح",
  "validation.passwordMin": "يجب أن تتكون كلمة المرور من 6 أحرف على الأقل",
  "validation.passwordRequired": "يجب إدخال كلمة المرور",
  "validation.passwordMismatch": "كلمتا المرور غير متطابقتين",
  "validation.countryRequired": "يجب اختيار دولة",
  "validation.stadiumNameMin": "يجب إدخال اسم الملعب",

  "error.EMAIL_TAKEN": "يوجد حساب بالفعل بهذا البريد الإلكتروني",
  "error.VALIDATION_ERROR": "بيانات غير صالحة",
  "error.CREST_TOO_LARGE": "ملف الشعار كبير جدًا (الحد الأقصى 2 ميغابايت)",
  "error.CREST_BAD_TYPE": "نوع ملف غير مدعوم (يرجى رفع PNG أو JPG أو WEBP أو SVG)",
  "error.GENERIC": "حدث خطأ ما، حاول مرة أخرى",
}

export const TRANSLATIONS: Record<Locale, Record<keyof typeof he, string>> = { he, en, ar }

export type TranslationKey = keyof typeof he

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value)
}

export type Translator = (key: TranslationKey, vars?: Record<string, string>) => string

/** Plain (non-hook) translator - usable in server components that read the locale cookie directly. */
export function getTranslator(locale: Locale): Translator {
  return (key, vars) => {
    let text = TRANSLATIONS[locale][key] ?? TRANSLATIONS[DEFAULT_LOCALE][key] ?? key
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replace(`{${name}}`, value)
      }
    }
    return text
  }
}
