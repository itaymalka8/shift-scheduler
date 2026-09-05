// Fictional player name generator - common Israeli first/last names combined
// randomly, so squads read as plausible without representing any real person.
const FIRST_NAMES = [
  "איתי", "עומר", "יובל", "נועם", "רועי", "אלון", "דניאל", "עידן", "גיא",
  "ניר", "אלעד", "שי", "תומר", "אורי", "בר", "דור", "אריאל", "עמית",
  "טל", "יונתן", "מתן", "אור", "אביב", "ליאור", "רן", "עידו", "יאיר",
  "שגיא", "נדב", "אסף", "עומרי", "חן", "איתן", "רועי", "יובל", "בן",
  "אלירן", "קובי", "שלומי", "משה", "דוד", "יוסי", "אבי", "ראובן",
]

const LAST_NAMES = [
  "כהן", "לוי", "מזרחי", "פרץ", "ביטון", "אברהם", "דהן", "אזולאי", "גבאי",
  "חדד", "עמר", "מלכה", "אוחיון", "טולדנו", "וקנין", "שרעבי", "אלבז",
  "בוזגלו", "אשכנזי", "בן דוד", "בן חמו", "סבן", "יוסף", "אוחנה",
  "אלקיים", "בן שושן", "גולן", "הרוש", "זוהר", "טל", "כץ", "מור",
  "נחום", "סויסה", "עוזרי", "פרידמן", "צור", "קדוש", "רזניק", "שלום",
  "אביטן", "בכר", "גמליאל", "דיין",
]

/** Just enough of SeededRandom for this module, so it needn't import the match engine. */
export interface NameRandomSource {
  int(min: number, max: number): number
}

/**
 * Pass a seeded source to make the draw reproducible - youth generation
 * needs the same prospect to come out of a re-run identically. Omit it and
 * the pools are drawn from Math.random exactly as before, so squad
 * generation is unchanged.
 */
export function generatePlayerName(rng?: NameRandomSource): { firstName: string; lastName: string } {
  const pick = <T,>(items: readonly T[]): T =>
    rng ? items[rng.int(0, items.length - 1)] : items[Math.floor(Math.random() * items.length)]
  return { firstName: pick(FIRST_NAMES), lastName: pick(LAST_NAMES) }
}
