// The sentinel matchday value production tooling treats as "this fixture is
// QA residue, not a real league round" - chosen because no real league
// schedule (round-robin over a season) can ever reach a matchday this high.
// A row with this matchday in Production means some QA/synthetic-season
// driver's cleanup step didn't finish.
export const QA_MATCHDAY = 999999

export function isQaMatchday(matchday: number): boolean {
  return matchday === QA_MATCHDAY
}
