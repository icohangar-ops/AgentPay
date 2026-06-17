import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { serviceId, agentId, agentName, rating, comment } = body

    if (!serviceId || !agentId || !agentName || rating == null) {
      return NextResponse.json(
        { error: 'Missing required fields: serviceId, agentId, agentName, rating' },
        { status: 400 }
      )
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: 'Rating must be between 1 and 5' },
        { status: 400 }
      )
    }

    const service = await db.service.findUnique({ where: { id: serviceId } })
    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    }

    const review = await db.review.create({
      data: {
        serviceId,
        agentId,
        agentName,
        rating: parseInt(rating),
        comment: comment || '',
      },
    })

    // Recalculate average rating and review count
    const agg = await db.review.aggregate({
      where: { serviceId },
      _avg: { rating: true },
      _count: true,
    })

    await db.service.update({
      where: { id: serviceId },
      data: {
        rating: Math.round((agg._avg.rating || 0) * 100) / 100,
        reviewCount: agg._count,
      },
    })

    return NextResponse.json({ review }, { status: 201 })
  } catch (error) {
    console.error('Error creating review:', error)
    return NextResponse.json(
      { error: 'Failed to create review' },
      { status: 500 }
    )
  }
}