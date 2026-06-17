import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateKeyPair, getPublicKeyCasperHex, toHex } from '@/lib/casper/deploys'
import { getAccountBalance, requestFaucetFunds } from '@/lib/casper/client'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { amount, generateKeys, faucetDrip } = body

    const agent = await db.agent.findUnique({ where: { id } })
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // ═══════════════════════════════════════════════════════════
    // GENERATE ON-CHAIN KEYPAIR
    // ═══════════════════════════════════════════════════════════
    if (generateKeys) {
      const keyPair = generateKeyPair()
      const privateKeyHex = toHex(keyPair.privateKey)

      // Update agent with real keys
      const updatedAgent = await db.agent.update({
        where: { id },
        data: {
          publicKey: keyPair.publicKeyHex.replace(/^0x/, ''),
          privateKey: privateKeyHex,
          isOnChain: true,
        },
      })

      return NextResponse.json({
        agent: updatedAgent,
        keyGenerated: true,
        publicKey: keyPair.publicKeyHex,
        accountHash: keyPair.accountHash,
      })
    }

    // ═══════════════════════════════════════════════════════════
    // REQUEST FAUCET FUNDS (testnet only)
    // ═══════════════════════════════════════════════════════════
    if (faucetDrip && agent.isOnChain && agent.publicKey) {
      const faucetResult = await requestFaucetFunds(
        getPublicKeyCasperHex(agent.publicKey)
      )

      // Try to get updated balance
      let onChainBalance = agent.onChainBalance
      try {
        const balance = await getAccountBalance(getPublicKeyCasperHex(agent.publicKey))
        onChainBalance = balance.balanceCSPR
      } catch {
        // Balance might take a moment to update
      }

      const updatedAgent = await db.agent.update({
        where: { id },
        data: { onChainBalance },
      })

      return NextResponse.json({
        agent: updatedAgent,
        faucetResult,
        onChainBalance,
      })
    }

    // ═══════════════════════════════════════════════════════════
    // REFRESH ON-CHAIN BALANCE
    // ═══════════════════════════════════════════════════════════
    if (agent.isOnChain && agent.publicKey && !amount) {
      try {
        const balance = await getAccountBalance(getPublicKeyCasperHex(agent.publicKey))
        const updatedAgent = await db.agent.update({
          where: { id },
          data: { onChainBalance: balance.balanceCSPR },
        })
        return NextResponse.json({
          agent: updatedAgent,
          onChainBalance: balance.balanceCSPR,
          balanceMotes: balance.balanceMotes,
        })
      } catch (err) {
        return NextResponse.json(
          { error: `Balance query failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
          { status: 500 }
        )
      }
    }

    // ═══════════════════════════════════════════════════════════
    // DEMO MODE: Add local balance
    // ═══════════════════════════════════════════════════════════
    if (amount == null || parseFloat(amount) <= 0) {
      return NextResponse.json(
        { error: 'amount must be a positive number' },
        { status: 400 }
      )
    }

    const updatedAgent = await db.agent.update({
      where: { id },
      data: { balance: { increment: parseFloat(amount) } },
    })

    return NextResponse.json({
      agent: updatedAgent,
      funded: parseFloat(amount),
      newBalance: updatedAgent.balance,
    })
  } catch (error) {
    console.error('Error funding agent:', error)
    return NextResponse.json(
      { error: `Failed to fund agent: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    )
  }
}