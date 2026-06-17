import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'
import { cspRToMotes, formatMotesToCSPR, fromHex, getPublicKeyCasperHex, createAndSendTransfer, getAccountBalance } from '@/lib/casper/deploys'
import { TESTNET, MOTES_PER_CSPR } from '@/lib/casper/constants'

const MOCK_RESPONSES: Record<string, () => object> = {
  'AI Inference': () => ({
    result: {
      generated_text: 'The Casper Network provides a highly scalable and secure platform for deploying smart contracts...',
      model: 'gpt-4-turbo',
      tokens: { prompt: 24, completion: 186, total: 210 },
      usage: { input_tokens: 24, output_tokens: 186 },
    },
  }),
  'DeFi Oracle': () => ({
    result: {
      pair: 'CSPR/USDT',
      price: 0.0412,
      volume_24h: 1_245_000,
      change_24h: 2.34,
      sources: ['Binance', 'CoinGecko', 'DexScreener'],
      timestamp: new Date().toISOString(),
    },
  }),
  'Data API': () => ({
    result: {
      data_points: 156,
      records: [
        { wallet: '0x1234...abcd', tx_count: 892, volume: 15420.5 },
        { wallet: '0x5678...ef01', tx_count: 445, volume: 8230.2 },
      ],
      summary: { total_volume: 2_365_000, unique_addresses: 12_456 },
    },
  }),
  'RWA Valuation': () => ({
    result: {
      property_id: 'RWA-2024-001',
      estimated_value: 425000,
      confidence: 0.92,
      comparables: 12,
      factors: ['location', 'size', 'condition', 'market_trend'],
      valuation_date: new Date().toISOString().split('T')[0],
    },
  }),
  Identity: () => ({
    result: {
      verification_status: 'verified',
      risk_score: 0.12,
      checks: {
        kyc_level: 3,
        aml_screening: 'clear',
        sanctions_check: 'clear',
        pep_check: 'clear',
      },
      compliance: { jurisdiction: 'US-EU', framework: 'GDPR+SOX' },
    },
  }),
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { agentId, onChain } = body

    if (!agentId) {
      return NextResponse.json(
        { error: 'agentId is required' },
        { status: 400 }
      )
    }

    const service = await db.service.findUnique({ where: { id } })
    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    }

    const agent = await db.agent.findUnique({ where: { id: agentId } })
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const price = service.pricePerCall
    const requestId = `x402-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`
    const latencyMs = service.latency + Math.floor(Math.random() * 50 - 25)

    // Get mock response data (always the same — service data is independent of payment method)
    const responseGenerator = MOCK_RESPONSES[service.category] || MOCK_RESPONSES['Data API']
    const responseData = JSON.stringify(responseGenerator())

    // ═══════════════════════════════════════════════════════════
    // ON-CHAIN MODE: Real CSPR transfer on Casper Testnet
    // ═══════════════════════════════════════════════════════════
    if (onChain && agent.isOnChain && agent.privateKey) {
      // Verify on-chain balance
      try {
        const chainBalance = await getAccountBalance(getPublicKeyCasperHex(agent.publicKey))
        const balanceMotes = BigInt(chainBalance.balanceMotes)
        const amountMotes = cspRToMotes(price)
        const gasMotes = 100_000_000n // 0.1 CSPR gas

        if (balanceMotes < amountMotes + gasMotes) {
          return NextResponse.json(
            {
              error: 'Insufficient on-chain balance',
              required: formatMotesToCSPR(amountMotes + gasMotes) + ' CSPR',
              available: chainBalance.balanceCSPR + ' CSPR',
            },
            { status: 402 }
          )
        }

        // Execute real on-chain transfer
        const transferResult = await createAndSendTransfer({
          senderPrivateKey: fromHex(agent.privateKey),
          senderPublicKeyHex: agent.publicKey,
          recipientPublicKeyHex: service.providerAddr,
          amountMotes,
          paymentAmount: gasMotes,
        })

        // Refresh on-chain balance cache
        const newBalance = await getAccountBalance(getPublicKeyCasperHex(agent.publicKey))

        // Create payment record
        const payment = await db.$transaction(async (tx) => {
          await tx.agent.update({
            where: { id: agentId },
            data: {
              balance: { decrement: price },
              onChainBalance: newBalance.balanceCSPR,
            },
          })

          const newPayment = await tx.payment.create({
            data: {
              agentId,
              serviceId: id,
              amount: price,
              status: 'completed',
              txHash: transferResult.deployHash,
              requestId,
              responseData,
              latencyMs: latencyMs + 2000, // Add network latency estimate
              onChain: true,
              deployHash: transferResult.deployHash,
              deployStatus: 'confirmed',
            },
          })

          await tx.service.update({
            where: { id },
            data: {
              totalCalls: { increment: 1 },
              totalRevenue: { increment: price },
            },
          })

          return newPayment
        })

        return NextResponse.json({
          payment,
          x402Flow: {
            step1: {
              status: 402,
              message: 'Payment Required',
              x402Version: '1.0',
              service: service.name,
              price,
              currency: 'CSPR',
              payTo: service.providerAddr,
              onChain: true,
            },
            step2: {
              status: 'on_chain_payment',
              message: 'Transfer submitted to Casper Testnet',
              txHash: transferResult.deployHash,
              requestId,
              amount: price,
              confirmed: true,
              explorerUrl: transferResult.explorerUrl,
              blockExplorer: `${TESTNET.explorerUrl}${transferResult.deployHash.replace(/^0x/, '')}`,
            },
            step3: {
              status: 200,
              message: 'Service response delivered (on-chain verified)',
              requestId,
              latencyMs,
              data: JSON.parse(responseData),
            },
          },
          onChain: true,
          transferResult,
        })
      } catch (chainError) {
        console.error('On-chain payment error:', chainError)
        return NextResponse.json(
          { error: `On-chain payment failed: ${chainError instanceof Error ? chainError.message : 'Unknown error'}` },
          { status: 500 }
        )
      }
    }

    // ═══════════════════════════════════════════════════════════
    // DEMO MODE: Simulated payment (original behavior)
    // ═══════════════════════════════════════════════════════════

    if (agent.balance < price) {
      return NextResponse.json(
        {
          error: 'Insufficient balance',
          required: price,
          available: agent.balance,
        },
        { status: 402 }
      )
    }

    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`

    const payment = await db.$transaction(async (tx) => {
      await tx.agent.update({
        where: { id: agentId },
        data: { balance: { decrement: price } },
      })

      const newPayment = await tx.payment.create({
        data: {
          agentId,
          serviceId: id,
          amount: price,
          status: 'completed',
          txHash,
          requestId,
          responseData,
          latencyMs,
        },
      })

      await tx.service.update({
        where: { id },
        data: {
          totalCalls: { increment: 1 },
          totalRevenue: { increment: price },
        },
      })

      return newPayment
    })

    return NextResponse.json({
      payment,
      x402Flow: {
        step1: {
          status: 402,
          message: 'Payment Required',
          x402Version: '1.0',
          service: service.name,
          price,
          currency: 'CSPR',
          payTo: service.providerAddr,
          onChain: false,
        },
        step2: {
          status: 'payment_proof',
          message: 'Payment verified (demo mode)',
          txHash,
          requestId,
          amount: price,
          confirmed: true,
        },
        step3: {
          status: 200,
          message: 'Service response delivered',
          requestId,
          latencyMs,
          data: JSON.parse(responseData),
        },
      },
      onChain: false,
    })
  } catch (error) {
    console.error('Error executing x402 call:', error)
    return NextResponse.json(
      { error: 'Failed to execute service call' },
      { status: 500 }
    )
  }
}