/**
 * Match engine balance suite. Runs many thousands of simulated matches and
 * asserts the engine still behaves like football: a real but modest home
 * advantage, realistic goal/shot/card/corner rates, quality mattering
 * without guaranteeing results, no dominant tactic, tactics that only pay
 * off for squads suited to them, and fatigue/crowd/keeper all having a
 * measurable but bounded effect.
 *
 * Run with:  npx tsx scripts/match-balance-suite.ts
 * Override sample size with:  N=20000 npx tsx scripts/match-balance-suite.ts
 *
 * Every comparison uses cloneTeam so exactly one variable differs between
 * the two sides - otherwise squad-generation noise swamps the effect.
 */
import { makeTestTeam, runSeries, makeTestSnapshot, cloneTeam } from "../src/lib/match/engine/test-harness"
import { simulateMatch } from "../src/lib/match/engine/engine"

const N = Number(process.env.N ?? 4000)
let fails = 0
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` :: ${detail}` : ""}`)
  if (!cond) fails++
}

// --- 1. IDENTICAL TEAMS: the spec's core fairness test --------------------
const base = makeTestTeam("Base")
const identical = runSeries(base, base, N, "id")
console.log("\n=== IDENTICAL TEAMS (" + N + ") ===")
console.log(`home ${identical.homeWinPercent.toFixed(1)}% / draw ${identical.drawPercent.toFixed(1)}% / away ${identical.awayWinPercent.toFixed(1)}%`)
console.log(`goals ${identical.avgHomeGoals.toFixed(2)}-${identical.avgAwayGoals.toFixed(2)} (total ${identical.avgTotalGoals.toFixed(2)})`)
console.log(`shots ${identical.avgShots.toFixed(1)} onTarget ${identical.avgShotsOnTarget.toFixed(1)} corners ${identical.avgCorners.toFixed(1)}`)
console.log(`fouls ${identical.avgFouls.toFixed(1)} yellow ${identical.avgYellowCards.toFixed(2)} red ${identical.avgRedCards.toFixed(3)} pens ${identical.avgPenalties.toFixed(3)}`)
console.log(`offsides ${identical.avgOffsides.toFixed(2)} injuries ${identical.avgInjuries.toFixed(3)} possession ${identical.avgHomePossession.toFixed(1)}%`)

check("identical teams: home edge exists but is modest (40-52%)", identical.homeWinPercent > 40 && identical.homeWinPercent < 52)
check("identical teams: away still wins often (>24%)", identical.awayWinPercent > 24)
check("identical teams: home beats away (real home advantage)", identical.homeWinPercent > identical.awayWinPercent)
check("goals per match realistic (2.0-3.2)", identical.avgTotalGoals > 2.0 && identical.avgTotalGoals < 3.2)
check("shots per match realistic (18-32)", identical.avgShots > 18 && identical.avgShots < 32)
check("corners realistic (7-14)", identical.avgCorners > 7 && identical.avgCorners < 14)
check("fouls realistic (15-30)", identical.avgFouls > 15 && identical.avgFouls < 30)
check("yellows realistic (1.5-5)", identical.avgYellowCards > 1.5 && identical.avgYellowCards < 5)
check("reds rare (<0.2)", identical.avgRedCards < 0.2)
check("penalties rare (<0.4)", identical.avgPenalties < 0.4)
check("possession near even for identical teams (45-56)", identical.avgHomePossession > 45 && identical.avgHomePossession < 56)

// --- 2. QUALITY MATTERS, BUT UPSETS HAPPEN --------------------------------
const strong = makeTestTeam("Strong", { qualityOffset: 12 })
const weak = makeTestTeam("Weak", { qualityOffset: -12 })
const mismatch = runSeries(strong, weak, N, "mm")
const reverseMismatch = runSeries(weak, strong, N, "rmm")
console.log("\n=== QUALITY GAP (strong vs weak) ===")
console.log(`strong at home: ${mismatch.homeWinPercent.toFixed(1)}% / ${mismatch.drawPercent.toFixed(1)}% / ${mismatch.awayWinPercent.toFixed(1)}%`)
console.log(`weak at home:   ${reverseMismatch.homeWinPercent.toFixed(1)}% / ${reverseMismatch.drawPercent.toFixed(1)}% / ${reverseMismatch.awayWinPercent.toFixed(1)}%`)

check("strong team wins clearly more", mismatch.homeWinPercent > 65)
check("but never 100% - upsets remain possible", mismatch.awayWinPercent > 1.5)
check("weak team at home still mostly loses", reverseMismatch.awayWinPercent > 55)
check("weak team at home still wins sometimes", reverseMismatch.homeWinPercent > 5)

// --- 3. TACTICS MATTER, BUT NO TACTIC ALWAYS WINS -------------------------
console.log("\n=== TACTIC vs TACTIC (same squad both sides) ===")
const styles = ["counterAttack","shortPassing","directPlay","widePlay","centralPlay","possession"] as const
const winRates: Record<string, number> = {}
for (const style of styles) {
  const a = cloneTeam(base, "A")
  a.tactics = { ...a.tactics, attackingStyle: style }
  const b = cloneTeam(base, "B")
  b.tactics = { ...b.tactics, attackingStyle: "shortPassing" }
  const r = runSeries(a, b, 1500, `t-${style}`)
  winRates[style] = r.homeWinPercent
  console.log(`${style.padEnd(15)} vs shortPassing: ${r.homeWinPercent.toFixed(1)}% win, ${r.avgHomeGoals.toFixed(2)} goals`)
}
const rates = Object.values(winRates)
check("no attacking style is dominant (all < 65% win)", Math.max(...rates) < 65, `max ${Math.max(...rates).toFixed(1)}`)
check("no attacking style is useless (all > 28% win)", Math.min(...rates) > 28, `min ${Math.min(...rates).toFixed(1)}`)

// --- 4. TACTICS MUST SUIT THE PLAYERS -------------------------------------
console.log("\n=== TACTIC/SQUAD FIT ===")
// Same squad both times - only pace/acceleration differ, so any gap is
// attributable to whether the players actually suit a counter-attack.
const fast = cloneTeam(base, "Fast")
fast.tactics = { ...fast.tactics, attackingStyle: "counterAttack" }
const slow = cloneTeam(base, "Slow", (p) => { p.attributes.pace = 30; p.attributes.acceleration = 30 })
slow.tactics = { ...slow.tactics, attackingStyle: "counterAttack" }
const opponent = makeTestTeam("Opp")
const fastCounter = runSeries(fast, opponent, 1500, "fc")
const slowCounter = runSeries(slow, opponent, 1500, "sc")
console.log(`counter-attack with pace:    ${fastCounter.homeWinPercent.toFixed(1)}% win, ${fastCounter.avgHomeGoals.toFixed(2)} goals`)
console.log(`counter-attack without pace: ${slowCounter.homeWinPercent.toFixed(1)}% win, ${slowCounter.avgHomeGoals.toFixed(2)} goals`)
check("counter-attack is worse without pace (tactic is conditional on players)", slowCounter.avgHomeGoals < fastCounter.avgHomeGoals)

// --- 5. FATIGUE ------------------------------------------------------------
console.log("\n=== FATIGUE ===")
const fresh = cloneTeam(base, "Fresh", (p) => { p.fitness = 100 })
const tired = cloneTeam(base, "Tired", (p) => { p.fitness = 55 })
const freshR = runSeries(fresh, opponent, 1500, "fr")
const tiredR = runSeries(tired, opponent, 1500, "tr")
console.log(`fitness 100: ${freshR.homeWinPercent.toFixed(1)}% win, ${freshR.avgHomeGoals.toFixed(2)} goals`)
console.log(`fitness 55:  ${tiredR.homeWinPercent.toFixed(1)}% win, ${tiredR.avgHomeGoals.toFixed(2)} goals`)
check("low fitness measurably hurts", tiredR.homeWinPercent < freshR.homeWinPercent)

// --- 6. CROWD ---------------------------------------------------------------
console.log("\n=== CROWD (ultras vs calm, full house) ===")
const calmR = runSeries(base, base, 2500, "cr", { fanType: "calm", attendance: 10600, capacity: 10600 })
const ultrasR = runSeries(base, base, 2500, "cr", { fanType: "ultras", attendance: 10600, capacity: 10600 })
console.log(`calm crowd:   home ${calmR.homeWinPercent.toFixed(1)}%`)
console.log(`ultras crowd: home ${ultrasR.homeWinPercent.toFixed(1)}%`)
check("ultras give a measurable home edge", ultrasR.homeWinPercent > calmR.homeWinPercent)
check("but crowd is not decisive (<8pt swing)", Math.abs(ultrasR.homeWinPercent - calmR.homeWinPercent) < 8,
  `${(ultrasR.homeWinPercent - calmR.homeWinPercent).toFixed(1)}pt`)

// --- 7. GOALKEEPER ----------------------------------------------------------
console.log("\n=== GOALKEEPER ===")
const goodGk = cloneTeam(base, "GoodGK", (p) => {
  if (p.primaryPosition === "GK") {
    for (const k of ["reflexes","handling","diving","oneOnOne","goalkeeperPositioning","aerialAbility","penaltySaving"] as const) p.attributes[k] = 85
  }
})
const badGk = cloneTeam(base, "BadGK", (p) => {
  if (p.primaryPosition === "GK") {
    for (const k of ["reflexes","handling","diving","oneOnOne","goalkeeperPositioning","aerialAbility","penaltySaving"] as const) p.attributes[k] = 25
  }
})
const goodGkR = runSeries(opponent, goodGk, 1500, "gk1")
const badGkR = runSeries(opponent, badGk, 1500, "gk2")
console.log(`vs good keeper: ${goodGkR.avgHomeGoals.toFixed(2)} goals conceded`)
console.log(`vs bad keeper:  ${badGkR.avgHomeGoals.toFixed(2)} goals conceded`)
check("a bad keeper concedes more", badGkR.avgHomeGoals > goodGkR.avgHomeGoals)

// --- 8. DETERMINISM ---------------------------------------------------------
console.log("\n=== DETERMINISM ===")
const snap = makeTestSnapshot(base, base, "fixed-seed")
const r1 = simulateMatch(snap)
const r2 = simulateMatch(snap)
check("same seed reproduces exact score", r1.homeGoals === r2.homeGoals && r1.awayGoals === r2.awayGoals)
check("same seed reproduces exact event list", JSON.stringify(r1.events) === JSON.stringify(r2.events))
const other = simulateMatch(makeTestSnapshot(base, base, "different-seed"))
check("different seed gives a different match", JSON.stringify(r1.events) !== JSON.stringify(other.events))

// --- 9. RATINGS FROM ACTIONS, NOT OVERALL ------------------------------------
console.log("\n=== RATINGS ===")
const rated = simulateMatch(makeTestSnapshot(strong, weak, "rating-seed"))
const scorers = rated.playerStats.filter(s => s.goals > 0)
const idle = rated.playerStats.filter(s => s.goals === 0 && s.minutesPlayed > 60 && s.shots === 0)
if (scorers.length && idle.length) {
  const avgScorer = scorers.reduce((a,s)=>a+s.rating,0)/scorers.length
  const avgIdle = idle.reduce((a,s)=>a+s.rating,0)/idle.length
  console.log(`avg rating - scorers ${avgScorer.toFixed(2)} vs quiet ${avgIdle.toFixed(2)}`)
  check("goalscorers rate higher than anonymous players", avgScorer > avgIdle)
}
check("ratings stay in 1-10", rated.playerStats.every(s => s.rating >= 1 && s.rating <= 10))
check("player stats produced for both sides", new Set(rated.playerStats.map(s=>s.teamId)).size === 2)

console.log(fails === 0 ? "\n*** ALL BALANCE CHECKS PASSED ***" : `\n*** ${fails} CHECKS FAILED ***`)
process.exit(fails === 0 ? 0 : 1)
