import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { amount } = body

    if (amount == null || amount <= 0) {
      return NextResponse.json(
        { error: 'amount must be a positive number' },
        { status: 400 }
      )
    }

    const agent = await db.agent.findUnique({ where: { id } })
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const updatedAgent = await db.agent.update({
      where: { id },
      data: { balance: { increment: parseFloat(amount) } },
    })

    return NextResponse.json({
      agent: updatedAgent,
      funded: parseFloat(amount),
      newBalance: updatedAgent.balance,
    })
  } catch (error) {
    console.error('Error funding agent:', error)
    return NextResponse.json(
      { error: 'Failed to fund agent' },
      { status: 500 }
    )
  }
}