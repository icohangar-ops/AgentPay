import { NextRequest, NextResponse } from 'next/server';
import { getAccountBalance } from '@/lib/casper/client';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { publicKey } = body;

    if (!publicKey) {
      return NextResponse.json(
        { error: 'publicKey is required' },
        { status: 400 },
      );
    }

    const balance = await getAccountBalance(publicKey);
    return NextResponse.json(balance);
  } catch (error) {
    console.error('Balance query error:', error);
    return NextResponse.json(
      { error: `Failed to query balance: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    );
  }
}