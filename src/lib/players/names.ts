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

export function generatePlayerName(): { firstName: string; lastName: string } {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
  return { firstName, lastName }
}
