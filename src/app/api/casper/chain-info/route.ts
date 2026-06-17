import { NextResponse } from 'next/server';
import { getChainInfoFormatted } from '@/lib/casper/client';

export async function GET() {
  try {
    const info = await getChainInfoFormatted();
    return NextResponse.json(info);
  } catch (error) {
    console.error('Chain info error:', error);
    return NextResponse.json(
      { error: `Failed to get chain info: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    );
  }
}