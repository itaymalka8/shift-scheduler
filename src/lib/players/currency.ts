import { GAME_CURRENCY_SYMBOL } from "./config"

/** Full form for a single player's card - e.g. "₪2,400,000". */
export function formatMarketValue(amount: number): string {
  return `${GAME_CURRENCY_SYMBOL}${amount.toLocaleString("en-US")}`
}

/** Abbreviated form for squad/team totals - e.g. "₪38.4M", "₪850K". */
export function formatMarketValueCompact(amount: number): string {
  if (amount >= 1_000_000) {
    return `${GAME_CURRENCY_SYMBOL}${(amount / 1_000_000).toFixed(1)}M`
  }
  if (amount >= 1_000) {
    return `${GAME_CURRENCY_SYMBOL}${(amount / 1_000).toFixed(0)}K`
  }
  return formatMarketValue(amount)
}
