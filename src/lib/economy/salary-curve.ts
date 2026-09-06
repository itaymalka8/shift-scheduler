/**
 * THE PHASE 3R SALARY CURVE - the calibrated wage authority, and the only
 * place the four approved salary constants appear.
 *
 * WHAT WAS CALIBRATED. Phase 3R's economic proof did not invent a new wage
 * formula. It took the wage the existing shape function already produces for
 * a player - `calculateUncompressedPlayerSalary`, driven only by overall,
 * age, potential and primaryPosition - and transformed it:
 *
 *     w' = scale * N * PIVOT^c * w^(1 - c)
 *
 * with c = 0.50 (compression) and scale = 0.7305 (level). Two knobs, two
 * jobs, and deliberately orthogonal:
 *
 *   - c decides the SHAPE. Gate revenue is capped by stadium capacity; a wage
 *     curve is not. A pure scalar therefore cannot fix a curve - it moves
 *     every wage by the same ratio and leaves the top of the league earning
 *     more than any stadium can seat. Compression pulls the tail down and
 *     lifts the bottom, pivoting at PIVOT.
 *   - scale decides the LEVEL, and nothing else. That separation is what N is
 *     for (see below). Without it a solver reads compression as free money
 *     and deletes the sponsor - which is the single-lever answer the economic
 *     decision explicitly rejected.
 *
 * WHY THE COMPRESSION LIFTS SMALL WAGES. Below PIVOT the transform raises a
 * wage and above it lowers one; PIVOT itself is the fixed point (up to the
 * level term). That is the definition of compression, not a defect and not an
 * accident: it is the shape that was simulated, held three horizons and six
 * seeds, and was approved. The crossover and its magnitude are asserted in
 * salary-curve.test.ts so the behaviour can never drift unnoticed.
 *
 * WHY THE CURVE IS APPLIED TO THE FINISHED WAGE, NOT FOLDED INTO THE BANDS.
 * The obvious-looking alternative - rewrite SALARY_OVERALL_BANDS so the table
 * itself emits the compressed numbers - cannot reproduce the calibrated model,
 * and the reason is arithmetic rather than taste. The calibrated wage is
 *
 *     w' = K * sqrt(base * ageMult * potentialMult * positionMult)
 *
 * so every multiplier is square-rooted along with the base. A rewritten band
 * table compresses only `base` and then multiplies by UNCOMPRESSED modifiers,
 * which is a different function: it would silently more than double the real
 * spread between a goalkeeper and a striker relative to what was calibrated.
 * Two further terms cannot survive the fold at all - sqrt is concave, so a
 * linearly-interpolating band cannot represent it exactly, and the potential
 * bonus (1 + gap * weight) has no square root of the same form. Folding would
 * therefore be an approximation of an approximation, applied to the one thing
 * Phase 3R exists to make exact. Applying the calibrated transform to the
 * finished wage reproduces the simulated economy to the unit, which is what
 * "materially equivalent to the model that produced the proof" requires.
 * salary-parity.test.ts holds that claim to the number.
 */

/** The approved level. Chosen by the Phase 3R narrow recalibration; frozen. */
export const SALARY_SCALE = 0.7305

/** The approved compression exponent. Frozen. */
export const SALARY_COMPRESSION = 0.5

/**
 * The compression pivot - the wage the transform leaves (up to `scale`)
 * unchanged, and therefore the axis the curve rotates about. 20,000/week sits
 * inside the league's own wage distribution rather than at an edge, which is
 * what makes `scale` readable as a level: raising it lifts the whole league,
 * it does not tilt it.
 */
export const SALARY_COMPRESSION_PIVOT = 20_000

/**
 * THE WAGE-BILL NEUTRALISER, N.
 *
 * N = SUM(w) / SUM(PIVOT^c * w^(1-c)) over the league's players, so that at
 * scale = 1 the compression changes the SHAPE of the wage distribution and
 * leaves its TOTAL alone. Without it, `scale` and `c` are not independent:
 * every change of shape is also a change of level, and the two levers stop
 * meaning what the calibration says they mean.
 *
 * It is a frozen literal, not a value recomputed at runtime, for the same
 * reason the activation boundary is a literal: a constant that re-derives
 * itself from live data is not a constant. Recomputing N each week would let
 * the league's own wage drift feed back into its own wage level - the
 * definition of an uncontrolled loop, and precisely the "reward a club for
 * its own spending" shape the sponsor design was forbidden from having.
 *
 * MEASURED, NOT CHOSEN: 1.011958, computed once over the 1,320 Production
 * players in the snapshot the calibration ran against.
 * `prod:economy:parity` re-measures it against live Production every time it
 * runs and fails if the league has drifted far enough to matter.
 */
export const SALARY_COMPRESSION_NORMALISER = 1.011958

/**
 * The three constants above collapse into one multiplier, computed here once
 * rather than three times per player. Kept derived rather than hard-coded so
 * the approved constants stay the only editable numbers.
 */
export const SALARY_CURVE_COEFFICIENT =
  SALARY_SCALE * SALARY_COMPRESSION_NORMALISER * Math.pow(SALARY_COMPRESSION_PIVOT, SALARY_COMPRESSION)

/**
 * Apply the calibrated curve to one finished, uncompressed weekly wage.
 *
 * `Math.max(1, ...)` guards the zero case only: 0^0.5 is 0, which would hand
 * a player a wage of nothing rather than the smallest wage the curve can
 * produce. The floor is 1 currency unit of INPUT, not of output - the output
 * floor is whatever the curve maps SALARY_MIN to, which is far above it.
 *
 * Rounded to the unit, exactly as the calibration rounded it. It is
 * deliberately NOT re-rounded to SALARY_ROUNDING_UNIT: that rounding shapes
 * the pre-compression band table, and applying it again afterwards would move
 * every wage by up to half a unit away from the curve that was proven.
 */
export function applyCalibratedSalaryCurve(uncompressedWeeklySalary: number): number {
  return Math.round(
    SALARY_CURVE_COEFFICIENT * Math.pow(Math.max(1, uncompressedWeeklySalary), 1 - SALARY_COMPRESSION)
  )
}
