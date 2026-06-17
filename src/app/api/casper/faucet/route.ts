import { NextRequest, NextResponse } from 'next/server';
import { requestFaucetFunds } from '@/lib/casper/client';
import { getPublicKeyCasperHex } from '@/lib/casper/keys';

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

    // Ensure public key has Casper tag prefix
    const casperKey = publicKey.startsWith('01') && publicKey.length === 68
      ? publicKey
      : getPublicKeyCasperHex(publicKey);

    const result = await requestFaucetFunds(casperKey);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Faucet error:', error);
    return NextResponse.json(
      { error: `Faucet request failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    );
  }
}