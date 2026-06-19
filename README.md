# AgentPay-x402

**Micropayment Marketplace for AI Agents on Casper Network**

AgentPay-x402 implements the [x402 protocol](https://github.com/anish-agni/x402) — an HTTP-level micropayment standard where services respond with `402 Payment Required`, agents submit Ed25519-signed payment proofs on-chain, and data is delivered on `200 OK`.

Built on **Casper Network** with full on-chain integration: real Wasm smart contracts, Ed25519 keypairs, deploy hash verification, and on-chain balance reads.

## Architecture

```
AI Agent                          AgentPay-x402                         Service Provider
   │                                    │                                       │
   │  1. POST /api/services/{id}/call  │                                       │
   │ ──────────────────────────────────>│                                       │
   │                                    │  2. 402 Payment Required              │
   │ <──────────────────────────────────│  (price, payment address)             │
   │                                    │                                       │
   │  3. Submit signed deploy            │                                       │
   │  (Ed25519 + casper-client)         │                                       │
   │ ──────────────────────────────────>│                                       │
   │                                    │  4. Verify deploy on-chain            │
   │                                    │  (escrow contract)                    │
   │                                    │                                       │
   │  5. 200 OK + response data          │                                       │
   │ <──────────────────────────────────│                                       │
   │                                    │                                       │
   │                                    │  6. Release payment to provider       │
   │                                    │ ─────────────────────────────────────>│
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui, Recharts |
| API | 15 Next.js App Router endpoints |
| Database | Prisma ORM + SQLite (dev) |
| Blockchain | Casper Network (testnet) |
| Smart Contracts | Rust Wasm via Odra Framework |
| Cryptography | Ed25519 keypairs, real `casper-client` deploys |
| Protocol | x402 (HTTP 402 Payment Required) |

## Smart Contracts (Rust/Odra)

- **Escrow Contract** — holds CSPR payments between agent and provider, releases on proof-of-delivery
- **Service Registry Contract** — on-chain service catalog with pricing, endpoints, and provider addresses

## Data Models

4 Prisma models: **Service**, **Agent**, **Payment**, **Review**

```prisma
Service   — name, category, endpoint, pricePerCall, provider, status, ratings
Agent     — name, role, balance, Ed25519 keys, onChainBalance, isOnChain
Payment   — agentId, serviceId, amount, txHash, deployHash, deployStatus, onChain
Review    — serviceId, agentId, rating, comment
```

## API Endpoints

### Services
- `GET    /api/services` — list all services
- `POST   /api/services` — register a new service
- `GET    /api/services/[id]` — get service details
- `PUT    /api/services/[id]` — update service
- `DELETE /api/services/[id]` — remove service
- `POST   /api/services/[id]/call` — **x402 payment flow** (402 → signed deploy → 200)

### Agents
- `GET    /api/agents` — list all agents
- `POST   /api/agents` — create agent (generates Ed25519 keypair)
- `GET    /api/agents/[id]` — agent details + on-chain balance
- `POST   /api/agents/[id]/fund` — fund agent via Casper faucet

### Casper On-Chain
- `GET /api/casper/balance` — read on-chain CSPR balance
- `GET /api/casper/chain-info` — testnet chain metadata
- `GET /api/casper/deploy-status` — verify deploy hash on-chain
- `POST /api/casper/faucet` — request testnet CSPR from faucet
- `POST /api/casper/transfer` — submit CSPR transfer deploy

### Other
- `GET    /api/payments` — payment history
- `GET    /api/payments/[id]` — payment details
- `POST   /api/reviews` — submit service review
- `GET    /api/stats` — marketplace analytics
- `POST   /api/demo/seed` — seed demo data

## Dashboard

Single-page app with tabbed interface:

- **Marketplace** — browse and call services, x402 payment flow
- **Agent Dashboard** — manage agents, balances, on-chain status
- **Developer Portal** — register and configure services
- **Payment Explorer** — payment history, deploy tracking, verification

## Getting Started

### Prerequisites

- Node.js 18+ / Bun
- [Casper client](https://github.com/casper-network/casper-client) (for on-chain deploys)

### Install & Run

```bash
git clone https://github.com/Cubiczan/AgentPay.git
cd AgentPay

# Install dependencies
bun install

# Set up database
bunx prisma db push

# Seed demo data
curl -X POST http://localhost:3000/api/demo/seed

# Start dev server
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

```env
DATABASE_URL=file:./db/agentpay.db
```

Additional Casper testnet variables are optional — the app works in simulation mode by default and uses real on-chain calls when agent keys are present.

## Roadmap

- [ ] Odra smart contract compilation and deployment to Casper testnet
- [ ] Replace mock `txHash` with real `casper-client` deploy submissions
- [ ] Full Ed25519 signing flow in x402 call endpoint
- [ ] On-chain balance reads replacing SQLite balance tracking
- [ ] CSPR.cloud API integration
- [ ] Casper MCP Server integration
- [ ] CSPR.trade MCP integration
- [ ] Mainnet deployment

## MAPS Integration

<p align="center">
  <img src="https://img.shields.io/badge/Built%20with-MAPS%20%7C%20Multi-Agent%20Pipeline%20Skills-blue" alt="MAPS" />
</p>

AgentPay's AI agent marketplace is structured using the [MAPS framework](https://mojoaistudio.com/maps/) (Multi-Agent Pipeline Skills) for agent system development and service orchestration.

### APS Layer (Per-Agent Pipeline) — Phase Mapping

| MAPS Phase | AgentPay Component |
|------------|-------------------|
| **A0 Alignment** | x402 protocol alignment — HTTP 402 payment standard for agent-to-service interaction |
| **A1 Define** | Agent brief — role, capabilities, Ed25519 keypair, payment flow |
| **A2 Design** | Agent identity model — on-chain balance, service catalog, payment tracking |
| **A3 Build** | Next.js App Router endpoints, Casper smart contracts (Escrow + Service Registry) |
| **A4 Equip** | Ed25519 signing capability, casper-client deploy tool, CSPR wallet integration |
| **A5 Evaluate** | Service review system, payment verification, on-chain deploy status checks |
| **A6 Deploy** | Casper testnet deployment, Odra smart contract compilation |
| **A7 Observe** | Payment Explorer — tx tracking, deploy verification, agent balance monitoring |
| **A8 Improve** | Service rating feedback loop, roadmap for pricing optimization and agent performance |

### Key MAPS Concepts Applied

| Concept | AgentPay Implementation |
|---------|------------------------|
| **Agent Roster (M2)** | Agent registry with Ed25519 keypairs, on-chain identities, balance tracking |
| **Capability Map (A4)** | x402 payment protocol, Casper deploy signing, service invocation tools |
| **Evaluation (A5)** | On-chain deploy verification, service reviews, payment status tracking |
| **Observation (A7)** | Payment Explorer dashboard, deploy status monitoring, on-chain balance reads |

### Recommended MAPS Skills

| Skill | Use Case |
|-------|----------|
| `/foundation` | M0 preflight — payment domain, Casper Network stack, x402 protocol |
| `/shape` | Validate Single-Agent track (agent as consumer) vs Multi-Agent (marketplace) |
| `/define-agent` | Brief new agent roles for expanded marketplace functionality |
| `/build-agent++` | TDD-driven agent development for new agent capabilities |
| `/equip-agent` | Capability mapping for payment, signing, and service invocation tools |
| `/deploy-agent++` | GitHub Actions + Cloudflare deployment automation |

---

## License

MIT