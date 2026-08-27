// Deterministic name generator for the placeholder clubs that fill a
// division until real managers register and take their slots over (see
// seed.ts / signup.ts). Deliberately skips Israel's handful of truly famous
// club identities (Tel Aviv, Haifa, Jerusalem, Beer Sheva, Petah Tikva) so
// bot teams don't read as a specific real-world club.
const PREFIXES = ["הפועל", "מכבי", "בית\"ר", "עירוני", "הכוח", "א.ס"]

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

/** Returns `count` unique deterministic club names, e.g. "הפועל אשדוד". */
export function generateBotTeamNames(count: number): string[] {
  const names: string[] = []
  for (let round = 0; names.length < count && round < PREFIXES.length; round++) {
    for (const place of PLACES) {
      if (names.length >= count) break
      names.push(`${PREFIXES[round]} ${place}`)
    }
  }
  return names
}
