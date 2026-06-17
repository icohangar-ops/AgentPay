import { NextRequest, NextResponse } from 'next/server';
import { createAndSendTransfer, cspRToMotes, formatMotesToCSPR, fromHex } from '@/lib/casper/deploys';
import { getPublicKeyCasperHex } from '@/lib/casper/keys';
import { getAccountBalance } from '@/lib/casper/client';
import type { TransferResult } from '@/lib/casper/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { senderPrivateKeyHex, senderPublicKey, recipientPublicKey, amountCSPR, paymentAmountCSPR } = body;

    if (!senderPrivateKeyHex || !senderPublicKey || !recipientPublicKey || !amountCSPR) {
      return NextResponse.json(
        { error: 'senderPrivateKeyHex, senderPublicKey, recipientPublicKey, and amountCSPR are required' },
        { status: 400 },
      );
    }

    // Validate amounts
    const amountMotes = cspRToMotes(amountCSPR);
    if (amountMotes <= 0n) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    }

    // Check sender balance first
    const senderBalance = await getAccountBalance(getPublicKeyCasperHex(senderPublicKey));
    const senderMotes = BigInt(senderBalance.balanceMotes);
    const paymentMotes = paymentAmountCSPR ? cspRToMotes(paymentAmountCSPR) : 100_000_000n; // 0.1 CSPR gas
    const totalNeeded = amountMotes + paymentMotes;

    if (senderMotes < totalNeeded) {
      return NextResponse.json(
        {
          error: 'Insufficient on-chain balance',
          required: formatMotesToCSPR(totalNeeded) + ' CSPR',
          available: senderBalance.balanceCSPR + ' CSPR',
        },
        { status: 402 },
      );
    }

    // Decode private key from hex
    const privateKeyBytes = fromHex(senderPrivateKeyHex);

    // Build, sign, and submit the transfer
    const result: TransferResult = await createAndSendTransfer({
      senderPrivateKey: privateKeyBytes,
      senderPublicKeyHex: senderPublicKey,
      recipientPublicKeyHex: recipientPublicKey,
      amountMotes,
      paymentAmount: paymentMotes,
    });

    return NextResponse.json({
      success: true,
      ...result,
      senderBalanceAfter: senderBalance.balanceCSPR,
    });
  } catch (error) {
    console.error('Transfer error:', error);
    return NextResponse.json(
      { error: `Transfer failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    );
  }
}