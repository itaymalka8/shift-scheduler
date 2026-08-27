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
 * Returns `count` unique deterministic club names, e.g. "איחוד ירושלים".
 * Cycles through every place for each prefix before moving to the next
 * prefix, so any contiguous slice of up to PLACES.length names (i.e. any
 * one division) draws from distinct places - no city repeats within a
 * division as long as the division is smaller than the place list.
 *
 * `prefixOffset` shifts the starting prefix (pass a division's ordinal so
 * different divisions lean on different prefixes instead of every bot in
 * the country starting with the same one).
 */
export function generateBotTeamNames(count: number, prefixOffset = 0): string[] {
  const names: string[] = []
  for (let round = 0; names.length < count; round++) {
    const prefix = PREFIXES[(round + prefixOffset) % PREFIXES.length]
    for (const place of PLACES) {
      if (names.length >= count) break
      names.push(`${prefix} ${place}`)
    }
  }
  return names
}
