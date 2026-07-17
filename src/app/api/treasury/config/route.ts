import { NextRequest, NextResponse } from 'next/server';
import { getTreasuryConfig, updateTreasuryConfig } from '@/lib/treasury/agent';

export async function GET() {
  try {
    const cfg = await getTreasuryConfig();
    return NextResponse.json({ config: cfg });
  } catch (error) {
    console.error('Error fetching treasury config:', error);
    return NextResponse.json(
      { error: 'Failed to fetch treasury config' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const allowed = [
      'enabled',
      'intervalSeconds',
      'minBalanceCSPR',
      'maxSpendPerCycleCSPR',
      'allowedCategories',
      'llmModel',
      'dryRun',
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowed) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    const cfg = await updateTreasuryConfig(patch);
    return NextResponse.json({ config: cfg });
  } catch (error) {
    console.error('Error updating treasury config:', error);
    return NextResponse.json(
      { error: 'Failed to update treasury config' },
      { status: 500 }
    );
  }
}
