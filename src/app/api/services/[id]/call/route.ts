import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'

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
    const { agentId } = body

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

    // Step 1: Check balance
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

    // Generate x402 flow identifiers
    const txHash = `0x${crypto.randomBytes(32).toString('hex')}`
    const requestId = `x402-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`
    const latencyMs = service.latency + Math.floor(Math.random() * 50 - 25)

    // Get mock response data
    const responseGenerator = MOCK_RESPONSES[service.category] || MOCK_RESPONSES['Data API']
    const responseData = JSON.stringify(responseGenerator())

    // Step 2: Deduct balance and create payment (in transaction)
    const payment = await db.$transaction(async (tx) => {
      // Deduct from agent
      const updatedAgent = await tx.agent.update({
        where: { id: agentId },
        data: { balance: { decrement: price } },
      })

      // Create payment record
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

      // Update service stats
      await tx.service.update({
        where: { id },
        data: {
          totalCalls: { increment: 1 },
          totalRevenue: { increment: price },
        },
      })

      return newPayment
    })

    // Step 3: Return x402 flow response
    return NextResponse.json({
      payment,
      x402Flow: {
        step1: {
          status: 402,
          message: 'Payment Required',
          x402Version: '1.0',
          service: service.name,
          price: price,
          currency: 'CSPR',
          payTo: service.providerAddr,
        },
        step2: {
          status: 'payment_proof',
          message: 'Payment verified on-chain',
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
    })
  } catch (error) {
    console.error('Error executing x402 call:', error)
    return NextResponse.json(
      { error: 'Failed to execute service call' },
      { status: 500 }
    )
  }
}