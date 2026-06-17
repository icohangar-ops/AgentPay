import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const agent = await db.agent.findUnique({
      where: { id },
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
          include: {
            service: {
              select: { id: true, name: true, category: true },
            },
          },
        },
        reviews: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const paymentStats = await db.payment.aggregate({
      where: { agentId: id, status: 'completed' },
      _count: true,
      _sum: { amount: true },
    })

    return NextResponse.json({
      agent: {
        ...agent,
        paymentStats: {
          totalPayments: paymentStats._count,
          totalSpent: paymentStats._sum.amount || 0,
        },
      },
    })
  } catch (error) {
    console.error('Error fetching agent:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agent' },
      { status: 500 }
    )
  }
}