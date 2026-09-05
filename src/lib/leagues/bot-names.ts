// Deterministic name generator for the placeholder clubs that fill a
// division until real managers register and take their slots over (see
// seed.ts / assign.ts). Prefixes are fictional (no Hapoel/Maccabi/Beitar)
// so combining them with real place names doesn't recreate a real club's
// identity - the one real risk left is the "Bnei <place>" pattern some
// actual Israeli clubs use, so Sakhnin and Reineh (home towns of Bnei
// Sakhnin and Maccabi Bnei Reineh) are left out of the place list.
const PREFIXES = [
  "איחוד", "בני", "החדשה", "הישנה", "כוכבי", "שועלי", "אריות", "סוסי",
  "נשרי", "זאבי", "נמרי", "ברקי", "דובי", "גיבורי", "אלופי", "לוחמי",
  "עיטי", "פרשי",
]

// Israeli cities and towns, roughly biggest-to-smallest, so the biggest
// settlements get used first as more divisions/tiers are seeded over time.
const PLACES = [
  "ירושלים", "תל אביב", "חיפה", "ראשון לציון", "פתח תקווה", "אשדוד",
  "נתניה", "באר שבע", "בני ברק", "חולון", "רמת גן", "רחובות", "בת ים",
  "בית שמש", "אשקלון", "הרצליה", "כפר סבא", "חדרה", "מודיעין מכבים רעות",
  "נהריה", "רעננה", "נצרת", "לוד", "רמלה", "רמת השרון", "קריית אתא",
  "קריית גת", "נוף הגליל", "עפולה", "ראש העין", "קריית מוצקין",
  "קריית ים", "קריית ביאליק", "כרמיאל", "טבריה", "אום אל פחם",
  "קריית אונו", "אור יהודה", "גבעתיים", "טירה", "נשר", "כפר יונה",
  "יבנה", "דימונה", "טייבה", "מגדל העמק", "שפרעם", "באקה אל-גרבייה",
  "טמרה", "עכו", "מעלות תרשיחא", "שדרות", "קריית שמונה", "ערד", "אילת",
  "נתיבות", "אופקים", "יהוד מונוסון", "גני תקווה", "גדרה", "אבן יהודה",
  "פרדסיה", "זכרון יעקב", "בנימינה גבעת עדה", "טירת כרמל", "קריית טבעון",
  "יקנעם עילית", "בית שאן", "ראש פינה", "מטולה", "צפת", "קצרין",
  "מעלה אדומים", "גבעת שמואל", "אלעד", "מודיעין עילית", "אפרת", "אריאל",
  "קריית מלאכי", "אור עקיבא", "נורדיה", "כפר קאסם", "ג'לג'וליה",
  "קלנסווה", "טורעאן", "ג'וליס", "רמה", "פקיעין", "חורפיש", "ירכא",
  "אבו סנאן", "שעב", "כאבול", "כפר מנדא", "כפר כנא", "נין", "אכסאל",
  "דבוריה", "בית ג'ן", "דיר חנא", "עראבה", "מגד אל כרום", "בענה", "חורה",
  "רהט", "שגב שלום", "תל שבע", "לקיה", "כסיפה",
]

/**
 * Returns `count` unique deterministic club names, e.g. "איחוד ירושלים",
 * starting at `startIndex` in a shared place/prefix sequence (pass a
 * running total of teams generated so far - one continuous counter across
 * every division, not reset per call - so different divisions land on
 * different places and prefixes instead of overlapping).
 *
 * Places advance once per name, so within any one division (count places
 * ≤ PLACES.length) every place is distinct - no repeated city. Prefixes
 * also advance once per name but the prefix list is shorter (18), so a
 * prefix repeats at most ⌈count / 18⌉ times within a division - for a
 * 20-team division that's at most twice, never three teams sharing one
 * prefix in a row.
 */
export function generateBotTeamNames(count: number, startIndex = 0): string[] {
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const n = startIndex + i
    const place = PLACES[n % PLACES.length]
    const prefix = PREFIXES[n % PREFIXES.length]
    names.push(`${prefix} ${place}`)
  }
  return names
}
