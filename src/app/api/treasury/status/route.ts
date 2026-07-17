import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTreasuryConfig } from '@/lib/treasury/agent';

export async function GET() {
  try {
    const cfg = await getTreasuryConfig();

    const lastCycle = await db.treasuryDecision.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { cycleId: true, createdAt: true },
    });

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentStats = await db.treasuryDecision.aggregate({
      where: { createdAt: { gte: last24h } },
      _count: true,
    });

    const executedStats = await db.treasuryDecision.aggregate({
      where: { status: 'executed', createdAt: { gte: last24h } },
      _count: true,
      _sum: { amountCSPR: true },
    });

    const dryRunStats = await db.treasuryDecision.aggregate({
      where: { status: 'dry_run', createdAt: { gte: last24h } },
      _count: true,
    });

    return NextResponse.json({
      enabled: cfg.enabled,
      dryRun: cfg.dryRun,
      llmModel: cfg.llmModel,
      intervalSeconds: cfg.intervalSeconds,
      minBalanceCSPR: cfg.minBalanceCSPR,
      maxSpendPerCycleCSPR: cfg.maxSpendPerCycleCSPR,
      lastCycle: lastCycle?.createdAt ?? null,
      lastCycleId: lastCycle?.cycleId ?? null,
      decisionsLast24h: recentStats._count,
      executedLast24h: executedStats._count,
      dryRunLast24h: dryRunStats._count,
      spentLast24hCSPR: executedStats._sum.amountCSPR ?? 0,
    });
  } catch (error) {
    console.error('Error fetching treasury status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch treasury status' },
      { status: 500 }
    );
  }
}
