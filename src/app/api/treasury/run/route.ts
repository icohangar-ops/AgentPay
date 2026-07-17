import { NextRequest, NextResponse } from 'next/server';
import { runTreasuryCycle } from '@/lib/treasury/agent';

export async function POST(req: NextRequest) {
  try {
    // Optional override flags from the request body
    const body = await req.json().catch(() => ({}));
    const overrideDryRun = typeof body.dryRun === 'boolean' ? body.dryRun : undefined;

    // If a dry-run override is requested, apply it transiently (without persisting)
    if (overrideDryRun !== undefined) {
      const { updateTreasuryConfig } = await import('@/lib/treasury/agent');
      await updateTreasuryConfig({ dryRun: overrideDryRun });
    }

    const result = await runTreasuryCycle();
    return NextResponse.json({ cycle: result });
  } catch (error) {
    console.error('Error running treasury cycle:', error);
    return NextResponse.json(
      {
        error: 'Treasury cycle failed',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
