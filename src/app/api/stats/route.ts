import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const [payments, agents, services] = await Promise.all([
      db.payment.aggregate({
        where: { status: 'completed' },
        _count: true,
        _sum: { amount: true },
        _avg: { latencyMs: true },
      }),
      db.agent.count({ where: { status: 'active' } }),
      db.service.count({ where: { status: 'active' } }),
    ])

    return NextResponse.json({
      totalPayments: payments._count,
      totalVolume: payments._sum.amount || 0,
      activeAgents: agents,
      activeServices: services,
      avgLatency: Math.round(payments._avg.latencyMs || 0),
    })
  } catch (error) {
    console.error('Error fetching stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    )
  }
}