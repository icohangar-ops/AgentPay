import { NextRequest, NextResponse } from 'next/server';
import { getDeployStatus } from '@/lib/casper/client';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { deployHash, timeoutMs } = body;

    if (!deployHash) {
      return NextResponse.json(
        { error: 'deployHash is required' },
        { status: 400 },
      );
    }

    const result = await getDeployStatus(
      deployHash,
      timeoutMs ?? 60000,
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Deploy status error:', error);
    return NextResponse.json(
      { error: `Failed to check deploy: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    );
  }
}