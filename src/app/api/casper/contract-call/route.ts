import { NextRequest, NextResponse } from 'next/server'
import { fromHex, getPublicKeyCasperHex } from '@/lib/casper/keys'
import { createAndSendContractCall } from '@/lib/casper/contracts'
import type { ContractCallArg } from '@/lib/casper/contracts'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      senderPrivateKeyHex,
      senderPublicKey,
      contractHash,
      entryPoint,
      args,
      paymentAmountCSPR,
    } = body

    if (!senderPrivateKeyHex || !senderPublicKey || !contractHash || !entryPoint) {
      return NextResponse.json(
        { error: 'senderPrivateKeyHex, senderPublicKey, contractHash, and entryPoint are required' },
        { status: 400 },
      )
    }

    const result = await createAndSendContractCall({
      fromPublicKey: senderPublicKey,
      contractHash,
      entryPoint,
      args: (args ?? []) as ContractCallArg[],
      senderPrivateKey: fromHex(senderPrivateKeyHex),
      paymentAmount: paymentAmountCSPR
        ? BigInt(Math.round(parseFloat(paymentAmountCSPR) * 1_000_000_000))
        : undefined,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Contract call error:', error)
    return NextResponse.json(
      { error: `Contract call failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    )
  }
}