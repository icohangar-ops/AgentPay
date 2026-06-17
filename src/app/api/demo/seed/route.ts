import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'

const DEMO_SERVICES = [
  {
    name: 'GPT-4 Turbo API',
    category: 'AI Inference',
    pricePerCall: 0.05,
    latency: 245,
    description: 'High-quality text generation and reasoning',
    endpoint: 'https://ai.casper.network/v1/gpt4-turbo',
    provider: 'CasperAI Labs',
    providerAddr: '0xabc123def456abc123def456abc123def456abcd',
  },
  {
    name: 'Stable Diffusion XL',
    category: 'AI Inference',
    pricePerCall: 0.10,
    latency: 890,
    description: 'Image generation from text prompts',
    endpoint: 'https://ai.casper.network/v1/sdxl',
    provider: 'CasperAI Labs',
    providerAddr: '0xabc123def456abc123def456abc123def456abcd',
  },
  {
    name: 'Price Feed Aggregator',
    category: 'DeFi Oracle',
    pricePerCall: 0.01,
    latency: 32,
    description: 'Real-time price feeds from 12 DEXs',
    endpoint: 'https://oracle.casper.network/v1/prices',
    provider: 'CasperOracle',
    providerAddr: '0xdef789abc012def789abc012def789abc012def7',
  },
  {
    name: 'Yield Optimizer',
    category: 'DeFi Oracle',
    pricePerCall: 0.25,
    latency: 156,
    description: 'Optimal yield strategy recommendations',
    endpoint: 'https://oracle.casper.network/v1/yield',
    provider: 'CasperOracle',
    providerAddr: '0xdef789abc012def789abc012def789abc012def7',
  },
  {
    name: 'On-Chain Analytics',
    category: 'Data API',
    pricePerCall: 0.02,
    latency: 89,
    description: 'Wallet and transaction analytics',
    endpoint: 'https://data.casper.network/v1/analytics',
    provider: 'CasperData',
    providerAddr: '0x456abc789def456abc789def456abc789def456a',
  },
  {
    name: 'Weather Oracle',
    category: 'Data API',
    pricePerCall: 0.005,
    latency: 45,
    description: 'Global weather data for smart contracts',
    endpoint: 'https://data.casper.network/v1/weather',
    provider: 'CasperData',
    providerAddr: '0x456abc789def456abc789def456abc789def456a',
  },
  {
    name: 'Property Appraisal AI',
    category: 'RWA Valuation',
    pricePerCall: 0.50,
    latency: 1200,
    description: 'AI-powered real estate valuation',
    endpoint: 'https://rwa.casper.network/v1/appraisal',
    provider: 'CasperRWA',
    providerAddr: '0x789def012abc789def012abc789def012abc789d',
  },
  {
    name: 'KYC Verification Engine',
    category: 'Identity',
    pricePerCall: 0.15,
    latency: 340,
    description: 'Identity verification and compliance checks',
    endpoint: 'https://id.casper.network/v1/kyc',
    provider: 'CasperID',
    providerAddr: '0x012abc345def012abc345def012abc345def012a',
  },
]

const DEMO_AGENTS = [
  {
    name: 'TradeBot',
    role: 'consumer',
    balance: 50,
    publicKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
  {
    name: 'DataSentinel',
    role: 'consumer',
    balance: 25,
    publicKey: '023456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01',
  },
  {
    name: 'OracleProvider',
    role: 'provider',
    balance: 100,
    publicKey: '03456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123',
  },
  {
    name: 'RWAValuator',
    role: 'both',
    balance: 75,
    publicKey: '0456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234',
  },
]

const DEMO_REVIEWS = [
  { rating: 5, comment: 'Exceptional quality and fast response times. Highly recommended for production use.' },
  { rating: 4, comment: 'Reliable service with consistent performance. Minor latency spikes during peak hours.' },
  { rating: 5, comment: 'Best AI inference API on Casper. The response quality is outstanding.' },
  { rating: 3, comment: 'Good accuracy but pricing could be more competitive. Solid overall.' },
  { rating: 4, comment: 'Easy to integrate and well-documented. The x402 payment flow is seamless.' },
  { rating: 5, comment: 'Incredible real estate valuations. Saved us thousands in appraisal costs.' },
  { rating: 4, comment: 'Fast price feeds with excellent uptime. Perfect for DeFi applications.' },
  { rating: 5, comment: 'Top-notch KYC verification. Compliance team loves the detailed reports.' },
]

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function daysAgo(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(randomBetween(0, 23), randomBetween(0, 59), randomBetween(0, 59))
  return d
}

export async function POST() {
  try {
    // Clear existing data
    await db.payment.deleteMany()
    await db.review.deleteMany()
    await db.service.deleteMany()
    await db.agent.deleteMany()

    // Create services
    const services = []
    for (const s of DEMO_SERVICES) {
      const service = await db.service.create({
        data: {
          ...s,
          apiKey: `apk_${crypto.randomBytes(24).toString('hex')}`,
          status: 'active',
          tags: JSON.stringify([s.category.toLowerCase().replace(' ', '-')]),
          uptime: 99.5 + Math.random() * 0.5,
        },
      })
      services.push(service)
    }

    // Create agents
    const agents = []
    for (const a of DEMO_AGENTS) {
      const agent = await db.agent.create({
        data: {
          ...a,
          status: 'active',
        },
      })
      agents.push(agent)
    }

    // Create 20 payments (random distribution across agents and services)
    const payments = []
    for (let i = 0; i < 20; i++) {
      const agent = agents[i % agents.length]
      const service = services[i % services.length]
      const daysOld = randomBetween(0, 30)
      const latencyVariance = service.latency + randomBetween(-30, 60)

      const payment = await db.payment.create({
        data: {
          agentId: agent.id,
          serviceId: service.id,
          amount: service.pricePerCall * randomBetween(1, 5),
          status: 'completed',
          txHash: `0x${crypto.randomBytes(32).toString('hex')}`,
          requestId: `x402-${Date.now() - daysOld * 86400000}-${crypto.randomBytes(8).toString('hex')}`,
          responseData: '{"status":"ok","mock":true}',
          latencyMs: Math.max(1, latencyVariance),
          createdAt: daysAgo(daysOld),
        },
      })
      payments.push(payment)
    }

    // Create 8 reviews
    const reviews = []
    for (let i = 0; i < 8; i++) {
      const agent = agents[i % agents.length]
      const service = services[i % services.length]
      const reviewData = DEMO_REVIEWS[i]

      const review = await db.review.create({
        data: {
          serviceId: service.id,
          agentId: agent.id,
          agentName: agent.name,
          rating: reviewData.rating,
          comment: reviewData.comment,
          createdAt: daysAgo(randomBetween(1, 25)),
        },
      })
      reviews.push(review)
    }

    // Update service stats based on seeded payments
    for (const service of services) {
      const paymentAgg = await db.payment.aggregate({
        where: { serviceId: service.id, status: 'completed' },
        _count: true,
        _sum: { amount: true },
      })

      const reviewAgg = await db.review.aggregate({
        where: { serviceId: service.id },
        _avg: { rating: true },
        _count: true,
      })

      await db.service.update({
        where: { id: service.id },
        data: {
          totalCalls: paymentAgg._count,
          totalRevenue: paymentAgg._sum.amount || 0,
          rating: Math.round((reviewAgg._avg.rating || 0) * 100) / 100,
          reviewCount: reviewAgg._count,
        },
      })
    }

    // Deduct payment totals from agent balances (simulate spent)
    for (const agent of agents) {
      const spent = await db.payment.aggregate({
        where: { agentId: agent.id, status: 'completed' },
        _sum: { amount: true },
      })

      await db.agent.update({
        where: { id: agent.id },
        data: {
          balance: agent.balance - (spent._sum.amount || 0),
        },
      })
    }

    return NextResponse.json(
      {
        message: 'Demo data seeded successfully',
        counts: {
          services: services.length,
          agents: agents.length,
          payments: payments.length,
          reviews: reviews.length,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error seeding demo data:', error)
    return NextResponse.json(
      { error: 'Failed to seed demo data' },
      { status: 500 }
    )
  }
}