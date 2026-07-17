import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const cycleId = url.searchParams.get('cycleId');
    const agentId = url.searchParams.get('agentId');

    const decisions = await db.treasuryDecision.findMany({
      take: Math.min(limit, 200),
      orderBy: { createdAt: 'desc' },
      where: {
        ...(cycleId ? { cycleId } : {}),
        ...(agentId ? { agentId } : {}),
      },
      include: {
        agent: { select: { id: true, name: true, role: true } },
        service: { select: { id: true, name: true, category: true, pricePerCall: true } },
        payment: { select: { id: true, deployHash: true, status: true } },
      },
    });

    return NextResponse.json({ decisions, count: decisions.length });
  } catch (error) {
    console.error('Error listing treasury decisions:', error);
    return NextResponse.json(
      { error: 'Failed to list treasury decisions' },
      { status: 500 }
    );
  }
}
