import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const service = await db.service.findUnique({
      where: { id },
      include: {
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        payments: {
          where: { status: 'completed' },
          select: {
            id: true,
            amount: true,
            status: true,
            createdAt: true,
            latencyMs: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    })

    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    }

    const paymentStats = await db.payment.aggregate({
      where: { serviceId: id, status: 'completed' },
      _count: true,
      _sum: { amount: true },
      _avg: { latencyMs: true },
    })

    return NextResponse.json({
      service: {
        ...service,
        paymentStats: {
          totalPayments: paymentStats._count,
          totalVolume: paymentStats._sum.amount || 0,
          avgLatency: Math.round(paymentStats._avg.latencyMs || 0),
        },
      },
    })
  } catch (error) {
    console.error('Error fetching service:', error)
    return NextResponse.json(
      { error: 'Failed to fetch service' },
      { status: 500 }
    )
  }
}