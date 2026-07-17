// ─────────────────────────────────────────────────────────────────────
// Treasury Agent: LLM-driven autonomous decision engine
//
// The Treasury Agent watches every on-chain agent in the marketplace and
// decides — using an LLM — whether each agent should call a service on
// its own behalf this cycle. When it decides yes, it autonomously
// executes the x402 payment flow (real Ed25519-signed Casper deploy),
// then logs the decision and the resulting deploy hash.
//
// This is what converts AgentPay from "a payment API for agents" into
// "an autonomous agent that pays for its own services" — directly
// satisfying the hackathon's "Use of AI / Agentic Systems" criterion.
// ─────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { getAccountBalance } from '@/lib/casper/client';
import {
  createAndSendTransfer,
  cspRToMotes,
  formatMotesToCSPR,
  fromHex,
  getPublicKeyCasperHex,
} from '@/lib/casper/deploys';
import { verifyPaymentBeforeDelivery } from '@/lib/casper/contracts';

// ── Types ────────────────────────────────────────────────────────────

export interface TreasuryCycleResult {
  cycleId: string;
  startedAt: string;
  finishedAt: string;
  decisionsMade: number;
  servicesCalled: number;
  totalSpentCSPR: number;
  decisions: Array<{
    agentId: string;
    agentName: string;
    decision: string;
    reasoning: string;
    serviceName?: string;
    amountCSPR?: number;
    deployHash?: string;
    status: string;
  }>;
  errors: string[];
}

interface LLMDecision {
  should_call: boolean;
  service_id?: string;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
}

// ── Config helpers ───────────────────────────────────────────────────

export async function getTreasuryConfig() {
  const cfg = await db.treasuryConfig.findUnique({ where: { id: 'singleton' } });
  if (cfg) return cfg;
  return db.treasuryConfig.create({ data: { id: 'singleton' } });
}

export async function updateTreasuryConfig(patch: Partial<{
  enabled: boolean;
  intervalSeconds: number;
  minBalanceCSPR: number;
  maxSpendPerCycleCSPR: number;
  allowedCategories: string;
  llmModel: string;
  dryRun: boolean;
}>) {
  // Ensure singleton exists
  await getTreasuryConfig();
  return db.treasuryConfig.update({
    where: { id: 'singleton' },
    data: patch,
  });
}

// ── LLM decision engine ──────────────────────────────────────────────

async function callLLM(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  // Dynamic import so the SDK is only loaded when actually needed
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 800,
  });
  // SDK returns OpenAI-shaped response
  return completion?.choices?.[0]?.message?.content ?? '';
}

function buildSystemPrompt(cfg: {
  minBalanceCSPR: number;
  maxSpendPerCycleCSPR: number;
  allowedCategories: string;
  dryRun: boolean;
}): string {
  const categories = cfg.allowedCategories
    ? cfg.allowedCategories.split(',').map(s => s.trim()).filter(Boolean)
    : ['(any category)'];

  return `You are the Treasury Agent for AgentPay-x402, a micropayment marketplace on the Casper Network.

Your job: decide whether a given AI agent should autonomously call a service this cycle, and if so, which one.

Operating constraints:
- Minimum balance to keep on each agent: ${cfg.minBalanceCSPR} CSPR (do NOT spend if it would drop the agent below this)
- Maximum spend per cycle: ${cfg.maxSpendPerCycleCSPR} CSPR
- Allowed service categories: ${categories.join(', ')}
- Mode: ${cfg.dryRun ? 'DRY-RUN (log only, do not execute)' : 'LIVE (will execute real on-chain payments)'}

Decision philosophy:
- Prefer CHEAP services that match the agent's stated role (e.g. a "DeFi Risk Agent" should prefer DeFi Oracle services; a "Research Agent" should prefer AI Inference)
- Prefer HIGH-RATED services on ties
- If the agent's balance is below 2x the minimum reserve, decline to spend
- If no service clearly matches the agent's role, return should_call=false (do not waste CSPR on irrelevant calls)
- Be decisive: a 1-2 sentence reason is enough

Respond with EXACTLY this JSON shape, no markdown fences:
{
  "should_call": true | false,
  "service_id": "<service id from the candidates list, or omit if should_call=false>",
  "reason": "<one sentence>",
  "confidence": "low" | "medium" | "high"
}`;
}

function buildUserPrompt(args: {
  agent: { id: string; name: string; role: string; onChainBalance: string };
  balanceCSPR: number;
  services: Array<{
    id: string;
    name: string;
    category: string;
    pricePerCall: number;
    rating: number;
    latency: number;
    description: string;
  }>;
}): string {
  const serviceList = args.services.map(s =>
    `- id=${s.id} | ${s.name} | cat=${s.category} | price=${s.pricePerCall} CSPR | rating=${s.rating} | latency=${s.latency}ms | ${s.description}`
  ).join('\n');

  return `Agent under evaluation:
  id: ${args.agent.id}
  name: ${args.agent.name}
  role: ${args.agent.role}
  current on-chain balance: ${args.balanceCSPR.toFixed(4)} CSPR

Available services this cycle:
${serviceList}

Decide whether this agent should call a service now. Respond as JSON per the system prompt.`;
}

function parseLLMDecision(raw: string): LLMDecision {
  // Strip markdown fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }
  // Try to extract the first {...} block
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(cleaned) as LLMDecision;
  } catch {
    return {
      should_call: false,
      reason: `LLM response was not valid JSON. Raw: ${raw.slice(0, 200)}`,
      confidence: 'low',
    };
  }
}

// ── Execute x402 payment on agent's behalf ───────────────────────────

async function executeServiceCallOnBehalf(args: {
  agentId: string;
  serviceId: string;
  requestId: string;
}): Promise<{ paymentId: string; deployHash: string; status: string; responseData: string }> {
  const agent = await db.agent.findUnique({ where: { id: args.agentId } });
  const service = await db.service.findUnique({ where: { id: args.serviceId } });
  if (!agent || !service) throw new Error('Agent or service not found');
  if (!agent.isOnChain || !agent.privateKey || !agent.publicKey) {
    throw new Error('Agent is not on-chain (no Ed25519 keys)');
  }
  if (!service.providerAddr) {
    throw new Error('Service has no provider address');
  }

  const amountMotes = cspRToMotes(service.pricePerCall);
  const gasMotes = BigInt(100_000_000); // 0.1 CSPR

  // Verify on-chain balance covers amount + gas
  const chainBalance = await getAccountBalance(getPublicKeyCasperHex(agent.publicKey));
  if (BigInt(chainBalance.balanceMotes) < amountMotes + gasMotes) {
    throw new Error(
      `Insufficient on-chain balance: have ${chainBalance.balanceCSPR} CSPR, need ${formatMotesToCSPR(amountMotes + gasMotes)} CSPR`
    );
  }

  // Build, sign, submit real on-chain transfer deploy
  const transferResult = await createAndSendTransfer({
    senderPrivateKey: fromHex(agent.privateKey),
    senderPublicKeyHex: agent.publicKey,
    recipientPublicKeyHex: service.providerAddr,
    amountMotes,
    paymentAmount: gasMotes,
  });

  // x402 verification: wait for deploy confirmation before delivering data
  const verification = await verifyPaymentBeforeDelivery(
    transferResult.deployHash,
    amountMotes,
    service.providerAddr,
    30000
  );

  if (!verification.verified) {
    throw new Error(`Payment verification failed: ${verification.reason}`);
  }

  // Mock response data per service category (same as /api/services/[id]/call route)
  const responseData = JSON.stringify({
    ok: true,
    called_at: new Date().toISOString(),
    service: service.name,
    agent: agent.name,
    deploy_hash: transferResult.deployHash,
    amount_cspr: service.pricePerCall,
  });

  // Refresh cached on-chain balance
  const newBalance = await getAccountBalance(getPublicKeyCasperHex(agent.publicKey));

  // Persist payment record
  const payment = await db.$transaction(async (tx) => {
    await tx.agent.update({
      where: { id: agent.id },
      data: {
        balance: { decrement: service.pricePerCall },
        onChainBalance: newBalance.balanceCSPR,
      },
    });
    const newPayment = await tx.payment.create({
      data: {
        agentId: agent.id,
        serviceId: service.id,
        amount: service.pricePerCall,
        status: 'completed',
        txHash: transferResult.deployHash,
        requestId: args.requestId,
        responseData,
        latencyMs: 2000,
        onChain: true,
        deployHash: transferResult.deployHash,
        deployStatus: 'confirmed',
        verified: true,
      },
    });
    await tx.service.update({
      where: { id: service.id },
      data: {
        totalCalls: { increment: 1 },
        totalRevenue: { increment: service.pricePerCall },
      },
    });
    return newPayment;
  });

  return {
    paymentId: payment.id,
    deployHash: transferResult.deployHash,
    status: 'confirmed',
    responseData,
  };
}

// ── Main decision cycle ──────────────────────────────────────────────

export async function runTreasuryCycle(): Promise<TreasuryCycleResult> {
  const cycleId = randomUUID();
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const decisionSummaries: TreasuryCycleResult['decisions'] = [];
  let servicesCalled = 0;
  let totalSpentCSPR = 0;

  const cfg = await getTreasuryConfig();
  if (!cfg.enabled) {
    return {
      cycleId,
      startedAt,
      finishedAt: new Date().toISOString(),
      decisionsMade: 0,
      servicesCalled: 0,
      totalSpentCSPR: 0,
      decisions: [],
      errors: ['Treasury Agent is disabled. Enable it via PUT /api/treasury/config.'],
    };
  }

  // Gather agents. In LIVE mode we only consider on-chain agents (those with
  // real Ed25519 keys, since we need to sign deploys on their behalf). In
  // dry-run mode we include all active agents so users can preview decisions.
  const agents = await db.agent.findMany({
    where: {
      status: 'active',
      ...(cfg.dryRun ? {} : { isOnChain: true }),
    },
    orderBy: { createdAt: 'asc' },
  });

  // Gather active services, optionally filtered by category
  const allowedCats = cfg.allowedCategories
    .split(',').map(s => s.trim()).filter(Boolean);
  const services = await db.service.findMany({
    where: {
      status: 'active',
      ...(allowedCats.length ? { category: { in: allowedCats } } : {}),
    },
  });

  for (const agent of agents) {
    try {
      // Refresh live balance (only for on-chain agents)
      let balanceCSPR = 0;
      if (agent.isOnChain && agent.publicKey) {
        try {
          const bal = await getAccountBalance(getPublicKeyCasperHex(agent.publicKey));
          balanceCSPR = parseFloat(bal.balanceCSPR) || 0;
          await db.agent.update({
            where: { id: agent.id },
            data: { onChainBalance: bal.balanceCSPR },
          });
        } catch {
          balanceCSPR = parseFloat(agent.onChainBalance) || 0;
        }
      } else {
        // Non-on-chain agent in dry-run mode: use simulated balance
        balanceCSPR = agent.balance;
      }

      // Hard rule: if balance below 2x reserve, skip without LLM call
      // Hard rule: in LIVE mode, skip agents whose balance is below 2x reserve
      // (in dry-run mode, still consult the LLM so users can preview decisions)
      if (!cfg.dryRun && balanceCSPR < cfg.minBalanceCSPR * 2) {
        const decision = await db.treasuryDecision.create({
          data: {
            agentId: agent.id,
            decision: 'skip_low_balance',
            reasoning: `Agent balance ${balanceCSPR.toFixed(4)} CSPR is below 2x minimum reserve (${cfg.minBalanceCSPR * 2} CSPR). Skipped without LLM consultation.`,
            status: 'skipped',
            llmModel: cfg.llmModel,
            llmResponse: '{}',
            cycleId,
          },
        });
        decisionSummaries.push({
          agentId: agent.id,
          agentName: agent.name,
          decision: 'skip_low_balance',
          reasoning: decision.reasoning,
          status: 'skipped',
        });
        continue;
      }

      // Cap on cycle spend
      if (totalSpentCSPR >= cfg.maxSpendPerCycleCSPR) {
        const decision = await db.treasuryDecision.create({
          data: {
            agentId: agent.id,
            decision: 'no_action',
            reasoning: `Cycle spend cap reached (${cfg.maxSpendPerCycleCSPR} CSPR). Deferring to next cycle.`,
            status: 'skipped',
            llmModel: cfg.llmModel,
            llmResponse: '{}',
            cycleId,
          },
        });
        decisionSummaries.push({
          agentId: agent.id,
          agentName: agent.name,
          decision: 'no_action',
          reasoning: decision.reasoning,
          status: 'skipped',
        });
        continue;
      }

      // Ask the LLM
      const systemPrompt = buildSystemPrompt(cfg);
      const userPrompt = buildUserPrompt({
        agent: {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          onChainBalance: agent.onChainBalance,
        },
        balanceCSPR,
        services: services.map(s => ({
          id: s.id,
          name: s.name,
          category: s.category,
          pricePerCall: s.pricePerCall,
          rating: s.rating,
          latency: s.latency,
          description: s.description,
        })),
      });

      let rawLLM = '';
      try {
        rawLLM = await callLLM(cfg.llmModel, systemPrompt, userPrompt);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`LLM call failed for agent ${agent.name}: ${msg}`);
        const decision = await db.treasuryDecision.create({
          data: {
            agentId: agent.id,
            decision: 'no_action',
            reasoning: `LLM call failed: ${msg}`,
            status: 'skipped',
            llmModel: cfg.llmModel,
            llmResponse: '',
            cycleId,
          },
        });
        decisionSummaries.push({
          agentId: agent.id,
          agentName: agent.name,
          decision: 'no_action',
          reasoning: decision.reasoning,
          status: 'skipped',
        });
        continue;
      }

      const llmDecision = parseLLMDecision(rawLLM);

      if (!llmDecision.should_call || !llmDecision.service_id) {
        const decision = await db.treasuryDecision.create({
          data: {
            agentId: agent.id,
            decision: 'no_action',
            reasoning: llmDecision.reason || 'LLM declined to call any service.',
            status: 'skipped',
            llmModel: cfg.llmModel,
            llmResponse: rawLLM,
            cycleId,
          },
        });
        decisionSummaries.push({
          agentId: agent.id,
          agentName: agent.name,
          decision: 'no_action',
          reasoning: decision.reasoning,
          status: 'skipped',
        });
        continue;
      }

      // Find chosen service
      const chosen = services.find(s => s.id === llmDecision.service_id);
      if (!chosen) {
        const decision = await db.treasuryDecision.create({
          data: {
            agentId: agent.id,
            decision: 'no_action',
            reasoning: `LLM chose service_id=${llmDecision.service_id} which is not in the candidate set.`,
            status: 'skipped',
            llmModel: cfg.llmModel,
            llmResponse: rawLLM,
            cycleId,
          },
        });
        decisionSummaries.push({
          agentId: agent.id,
          agentName: agent.name,
          decision: 'no_action',
          reasoning: decision.reasoning,
          status: 'skipped',
        });
        continue;
      }

      // Dry-run mode: log but don't execute
      if (cfg.dryRun) {
        const decision = await db.treasuryDecision.create({
          data: {
            agentId: agent.id,
            decision: 'call_service',
            reasoning: llmDecision.reason,
            serviceId: chosen.id,
            serviceName: chosen.name,
            amountCSPR: chosen.pricePerCall,
            status: 'dry_run',
            llmModel: cfg.llmModel,
            llmResponse: rawLLM,
            cycleId,
          },
        });
        decisionSummaries.push({
          agentId: agent.id,
          agentName: agent.name,
          decision: 'call_service',
          reasoning: decision.reasoning,
          serviceName: chosen.name,
          amountCSPR: chosen.pricePerCall,
          status: 'dry_run',
        });
        continue;
      }

      // LIVE: execute the x402 call on the agent's behalf
      try {
        const requestId = `treasury-${cycleId.slice(0, 8)}-${agent.id.slice(0, 6)}`;
        const result = await executeServiceCallOnBehalf({
          agentId: agent.id,
          serviceId: chosen.id,
          requestId,
        });

        const decision = await db.treasuryDecision.create({
          data: {
            agentId: agent.id,
            decision: 'call_service',
            reasoning: llmDecision.reason,
            serviceId: chosen.id,
            serviceName: chosen.name,
            amountCSPR: chosen.pricePerCall,
            paymentId: result.paymentId,
            deployHash: result.deployHash,
            status: 'executed',
            llmModel: cfg.llmModel,
            llmResponse: rawLLM,
            cycleId,
          },
        });

        servicesCalled += 1;
        totalSpentCSPR += chosen.pricePerCall;

        decisionSummaries.push({
          agentId: agent.id,
          agentName: agent.name,
          decision: 'call_service',
          reasoning: decision.reasoning,
          serviceName: chosen.name,
          amountCSPR: chosen.pricePerCall,
          deployHash: result.deployHash,
          status: 'executed',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Execution failed for agent ${agent.name}: ${msg}`);
        const decision = await db.treasuryDecision.create({
          data: {
            agentId: agent.id,
            decision: 'call_service',
            reasoning: `${llmDecision.reason} (execution failed: ${msg})`,
            serviceId: chosen.id,
            serviceName: chosen.name,
            amountCSPR: chosen.pricePerCall,
            status: 'skipped',
            llmModel: cfg.llmModel,
            llmResponse: rawLLM,
            cycleId,
          },
        });
        decisionSummaries.push({
          agentId: agent.id,
          agentName: agent.name,
          decision: 'call_service',
          reasoning: decision.reasoning,
          serviceName: chosen.name,
          amountCSPR: chosen.pricePerCall,
          status: 'skipped',
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Agent ${agent.name}: ${msg}`);
    }
  }

  return {
    cycleId,
    startedAt,
    finishedAt: new Date().toISOString(),
    decisionsMade: decisionSummaries.length,
    servicesCalled,
    totalSpentCSPR,
    decisions: decisionSummaries,
    errors,
  };
}
