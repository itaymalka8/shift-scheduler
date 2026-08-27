// Deterministic name generator for the placeholder clubs that fill a
// division until real managers register and take their slots over (see
// seed.ts / assign.ts). Deliberately avoids real club branding (Hapoel,
// Maccabi, Beitar, etc.) and Israel's handful of truly famous club
// identities (Tel Aviv, Haifa, Jerusalem, Beer Sheva, Petah Tikva) so bot
// teams never read as a specific real-world club.
const PREFIXES = [
  "איחוד", "בני", "החדשה", "הישנה", "כוכבי", "שועלי", "אריות", "סוסי",
  "נשרי", "זאבי", "נמרי", "ברקי", "דובי", "גיבורי", "אלופי", "לוחמי",
  "עיטי", "פרשי",
]

const PLACES = [
  "אשדוד", "אשקלון", "עפולה", "נתניה", "חדרה", "רעננה", "הרצליה", "לוד",
  "רמלה", "דימונה", "ערד", "טבריה", "צפת", "נהריה", "עכו", "קריית שמונה",
  "קריית גת", "קריית מוצקין", "קריית ים", "קריית ביאליק", "קריית אתא",
  "בת ים", "חולון", "גבעתיים", "רמת גן", "ראשון לציון", "רחובות",
  "נס ציונה", "גדרה", "יבנה", "אילת", "מגדל העמק", "יקנעם", "טירת כרמל",
  "שדרות", "נתיבות", "אופקים", "ירוחם", "מצפה רמון", "כרמיאל",
  "מעלות תרשיחא", "שלומי", "בית שאן", "עתלית", "אור יהודה", "כפר סבא",
  "הוד השרון", "רמת השרון", "ראש העין", "גבעת שמואל",
]

/**
 * Returns `count` unique deterministic club names, e.g. "איחוד אשדוד".
 * Cycles through every prefix for each place before moving to the next
 * place, so a full division's worth of names (~20-60) already samples
 * most prefixes instead of leaning on just the first one or two.
 */
export function generateBotTeamNames(count: number): string[] {
  const names: string[] = []
  for (const place of PLACES) {
    if (names.length >= count) break
    for (const prefix of PREFIXES) {
      if (names.length >= count) break
      names.push(`${prefix} ${place}`)
    }
  }
  return names
}
