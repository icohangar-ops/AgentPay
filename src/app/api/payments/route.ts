import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const agentId = searchParams.get('agentId')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}

    if (agentId) {
      where.agentId = agentId
    }

    if (status && status !== 'All') {
      where.status = status
    }

    const payments = await db.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        agent: {
          select: { id: true, name: true, role: true },
        },
        service: {
          select: { id: true, name: true, category: true },
        },
      },
    })

    return NextResponse.json({ payments })
  } catch (error) {
    console.error('Error listing payments:', error)
    return NextResponse.json(
      { error: 'Failed to list payments' },
      { status: 500 }
    )
  }
}