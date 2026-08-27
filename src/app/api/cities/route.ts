import { NextResponse } from "next/server"
import { City } from "country-state-city"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const country = searchParams.get("country")

  if (!country) {
    return NextResponse.json({ error: "MISSING_COUNTRY" }, { status: 400 })
  }

  const cities = City.getCitiesOfCountry(country) ?? []
  const names = Array.from(new Set(cities.map((c) => c.name))).sort((a, b) => a.localeCompare(b))

  return NextResponse.json({ cities: names })
}
