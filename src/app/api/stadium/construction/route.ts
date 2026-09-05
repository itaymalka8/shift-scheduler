import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  startStadiumConstruction,
  ConstructionInProgressError,
  NoSeatsRequestedError,
  InsufficientFundsError,
} from "@/lib/stadium/actions"
import { totalSeats } from "@/lib/stadium/construction"
import type { SeatCounts } from "@/lib/stadium/config"

function parseSeats(value: unknown): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : NaN
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) {
    return NextResponse.json({ error: "NO_TEAM" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const seatsToAdd: SeatCounts = {
    regular: parseSeats(body?.regular),
    covered: parseSeats(body?.covered),
    premium: parseSeats(body?.premium),
    vip: parseSeats(body?.vip),
  }

  if (Object.values(seatsToAdd).some((n) => Number.isNaN(n))) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
  }

  try {
    const job = await startStadiumConstruction(team.id, seatsToAdd)
    return NextResponse.json({
      job: {
        id: job.id,
        totalCost: job.totalCost,
        startedAt: job.startedAt,
        endsAt: job.endsAt,
        seatsAdded: totalSeats(seatsToAdd),
      },
    })
  } catch (error) {
    if (error instanceof NoSeatsRequestedError) {
      return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
    }
    if (error instanceof ConstructionInProgressError) {
      return NextResponse.json({ error: "CONSTRUCTION_IN_PROGRESS" }, { status: 409 })
    }
    if (error instanceof InsufficientFundsError) {
      return NextResponse.json(
        { error: "INSUFFICIENT_FUNDS", balance: error.balance, required: error.required },
        { status: 400 }
      )
    }
    console.error("Stadium construction failed", error)
    return NextResponse.json({ error: "UNKNOWN_ERROR" }, { status: 500 })
  }
}
