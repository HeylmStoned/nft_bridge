# Bad Bunnz Bridge

Trustless bidirectional NFT bridge between **Base Sepolia** (origin) and **MegaETH** (destination) using merkle proof verification. The relayer automatically submits merkle roots and unlocks NFTs, so users don't need to manually claim.

## Architecture

### System Overview

The bridge consists of three main components:

1. **Smart Contracts** - On-chain bridge logic with merkle proof verification
2. **Backend Services** - Event indexing, proof generation, and automated relayer
3. **Frontend** - User interface for bridging NFTs (separate repository)

### Bridge Flow

**Base Sepolia → MegaETH:**
```
User → lockNFT() → Event → Backend indexes → Merkle tree built → 
Relayer submits root → Relayer auto-unlocks → NFT minted/unlocked to recipient
```

**MegaETH → Base Sepolia (Reverse):**
```
User → lockNFTForEthereum() → Event → Backend indexes → Merkle tree built → 
Relayer submits root → Relayer auto-unlocks → Original NFT transferred back
```

**Key Features:**
- **Fully automated** - Relayer handles root submission and unlock (no manual claiming)
- **Block safety** - Event listener never skips blocks (critical for user funds)
- **Idempotent** - Retries are safe; duplicate processing is prevented
- **RPC resilient** - Handles free-tier RPC timeouts with smaller batches and retries

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Smart Contracts                           │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │EthereumBridge│◄───────►│MegaEthBridge │                 │
│  └──────┬───────┘         └──────┬───────┘                 │
│         │                        │                          │
│         └──────────┬─────────────┘                          │
│                    ▼                                        │
│            ┌──────────────┐                                 │
│            │  Bad_Bunnz   │                                 │
│            │   (NFT)      │                                 │
│            └──────────────┘                                 │
└────────────────────┬──────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend Services                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │Event Listener│  │Proof Generator│  │   Relayer    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│         └──────────┬───────┴──────────────────┘             │
│                    ▼                                        │
│            ┌──────────────┐                                 │
│            │  PostgreSQL  │                                 │
│            │   Database   │                                 │
│            └──────────────┘                                 │
│                    │                                        │
│                    ▼                                        │
│            ┌──────────────┐                                 │
│            │     Redis    │                                 │
│            │    (Queue)   │                                 │
│            └──────────────┘                                 │
└─────────────────────────────────────────────────────────────┘
```

## Contracts

### EthereumBridge.sol

Deployed on **Base Sepolia** (origin chain). Handles locking NFTs and unlocking from MegaETH.

**Core Functions:**
- `lockNFT(uint256 tokenId, address recipient)` - Lock NFT for bridging
- `batchLockNFT(uint256[] tokenIds, address recipient)` - Batch lock multiple NFTs
- `unlockNFTWithProof(...)` - Unlock NFT from MegaETH using merkle proof
- `setMegaEthBlockRoot(...)` - Set merkle root for MegaETH locks (rootSubmitter only)
- `pause()` / `unpause()` - Emergency controls (owner only)
- `isApprovedForAll(address user)` - Check if user approved bridge
- `isTokenApproved(uint256 tokenId, address owner)` - Check specific token approval

**State Management:**
- `lockedTokens[tokenId]` - Tracks locked tokens
- `processedLocks[lockHash]` - Prevents replay attacks
- `megaEthBlockRoots[blockNumber]` - Stores merkle roots from MegaETH
- `lockData[lockHash]` - Stores lock data for verification

### MegaEthBridge.sol

Deployed on MegaETH. Handles locking NFTs and minting/unlocking from Base Sepolia (origin chain).

**Core Functions:**
- `lockNFTForEthereum(uint256 tokenId, address recipient)` - Lock for reverse bridge (MegaETH → Base)
- `batchLockNFTForEthereum(...)` - Batch lock multiple NFTs
- `unlockNFTWithProof(...)` - Unlock/mint NFT from Base Sepolia using merkle proof
- `setBlockRoot(...)` - Set merkle root for Base Sepolia locks (rootSubmitter only)
- `pause()` / `unpause()` - Emergency controls (owner only)
- `isApprovedForAll(address user)` - Check if user approved bridge
- `isTokenApproved(uint256 tokenId, address owner)` - Check specific token approval

**State Management:**
- `activeOnMegaETH[tokenId]` - Tracks if token was ever minted on MegaETH
- `lockedTokens[tokenId]` - Tracks locked tokens (for round-trip)
- `processedLocks[lockHash]` - Prevents replay attacks
- `blockRoots[blockNumber]` - Stores merkle roots from Base Sepolia

**Round-Trip Logic:**
- First time: `activeOnMegaETH[tokenId] = false` → NFT is **minted**
- Round-trip: `activeOnMegaETH[tokenId] = true` → NFT is **unlocked** (no new mint)

### Bad_Bunnz.sol

ERC721C NFT contract with bridge support.

**Bridge Functions:**
- `bridgeMint(address to, uint256 tokenId)` - Mint via bridge (bridge only)
- `bridgeBurn(uint256 tokenId)` - Burn via bridge (bridge only)
- `setBridgeAddress(address bridge)` - Set bridge address (once only, owner only)
- `setTransferValidator(address validator)` - Disable transfer restrictions (required for bridge to receive)

**Features:**
- ERC721 Enumerable extension
- ERC2981 Royalties
- Supply cap enforcement
- Marketplace compatible (OpenSea, Blur, etc.)

**Important:** After deployment, call `setTransferValidator(0x0)` on both NFT contracts to disable ERC721C transfer restrictions. Otherwise, the bridge contract cannot receive tokens and `lockNFT` will revert. See `scripts/disable-nft-transfer-validator.cjs`.

## Security

### Security Features

1. **Reentrancy Protection** - All critical functions use `nonReentrant` modifier
2. **Access Controls** - Ownable for admin, onlyRootSubmitter for merkle roots
3. **Pause Mechanism** - Emergency stop capability (both bridges inherit `Pausable`)
4. **Cryptographic Verification** - Merkle proof verification using OpenZeppelin
5. **State Management** - Prevents replay attacks, double-minting, double-unlocking
6. **Input Validation** - Zero address checks, array validation, block verification
7. **Block Processing Safety** - Event listener never skips blocks (critical for user funds)
8. **Idempotent Operations** - Lock events use `ON CONFLICT DO NOTHING` for safe retries

### Trust Assumptions

- **Relayer Role** - Root submitter can submit merkle roots and auto-unlock NFTs (should use hardware wallet/multi-sig)
- **First-Come-First-Serve** - Merkle root submission is first-come-first-serve (mitigated by rootSubmitter role)
- **Pause Control** - Owner can pause bridge in emergency
- **RPC Reliability** - Backend trusts RPC providers for event logs (mitigated by retries and smaller batches)

### Block Processing Guarantees

The event listener ensures **no blocks are skipped**:
- Only advances `lastProcessedBlock` after successful batch processing
- On timeout, retries one block at a time and stops on first failure (doesn't skip)
- Idempotent lock event creation prevents duplicate processing on retries
- Catch-up on startup processes all missed blocks

**Missing a block would be fatal** - user's NFT would be locked on origin but never unlocked on destination. The system is designed to prevent this.

See [SECURITY.md](./SECURITY.md) for detailed security information and vulnerability reporting.

## Backend

### Services

**Event Listener** (`src/services/eventListener.js`)
- Listens to `NFTLocked` / `NFTUnlocked` events on both chains
- Stores lock data in PostgreSQL
- Queues proof generation jobs
- **Block safety**: Never advances `lastProcessedBlock` until batch fully succeeds
- **RPC resilient**: Uses small batches (10 blocks on Base) and retries one-by-one on timeout
- **Idempotent**: Lock event creation uses `ON CONFLICT DO NOTHING` for safe retries

**Proof Generator** (`src/services/proofGenerator.js`)
- Builds merkle trees from lock events in a block
- Generates merkle proofs for each lock (empty `[]` for single-lock blocks)
- Handles PostgreSQL JSONB correctly (proof may be array or string)
- Stores proofs in database

**Relayer** (`src/services/relayer.js`)
- Monitors pending merkle roots
- Submits roots to destination chains (checks on-chain first to avoid duplicates)
- **Auto-unlock**: After submitting root, automatically calls `unlockNFTWithProof` for each lock
- Checks relayer balances
- Handles failed transactions
- **Critical**: Relayer wallet must have gas on both chains (Base Sepolia + MegaETH)

**API Server** (`src/index.js`)
- REST API for bridge status, proofs, stats
- WebSocket server for real-time updates
- Rate limiting and API key protection

### Database Schema

- `lock_events` - All lock events from both chains
- `merkle_proofs` - Generated merkle proofs
- `block_roots` - Submitted merkle roots
- `unlock_events` - Unlock transactions
- `relayer_transactions` - Relayer transaction history
- `bridge_history` - Complete bridge history
- `system_metrics` - System health metrics

### Queue System

- **Proof Generation Queue** - Processes proof generation jobs
- **Root Submission Queue** - Processes root submission jobs
- Uses Redis + Bull for job management

## Setup

### Prerequisites

- Node.js >=18.0.0
- PostgreSQL database
- Redis instance
- Foundry (for contract testing)

### Installation

```bash
npm install
forge install
```

### Environment Variables

Copy `backend/.env.example` to `backend/.env`:

**Required:**
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `ETHEREUM_RPC_URL` - Base Sepolia RPC endpoint (origin chain)
- `ETHEREUM_BRIDGE_ADDRESS` - Base Sepolia bridge contract address
- `ETHEREUM_NFT_ADDRESS` - Base Sepolia Bad_Bunnz contract address
- `MEGAETH_RPC_URL` - MegaETH RPC endpoint (destination chain)
- `MEGAETH_BRIDGE_ADDRESS` - MegaETH bridge contract address
- `MEGAETH_NFT_ADDRESS` - MegaETH Bad_Bunnz contract address
- `RELAYER_PRIVATE_KEY` - Relayer private key (must be the `rootSubmitter` set in contracts)

**Optional:**
- `API_KEY` - API key for endpoint protection
- `AUTO_SUBMIT_ROOTS` - Auto-submit merkle roots and auto-unlock (default: `true` - **recommended**)
- `CONFIRMATION_BLOCKS` - Block confirmations before processing (default: 3)
- `LOG_LEVEL` - Logging level (default: `info`)

### Database Migration

```bash
cd backend
npm run db:migrate
```

### Start Services

```bash
# Start API server
cd backend
npm run start

# Start relayer (separate terminal)
cd backend
npm run relayer
```

## Deployment

### Contract Deployment

Use the deployment script (`scripts/deploy-and-mint.cjs`) which handles everything:

```bash
# Set env vars in scripts/.env:
# BASE_RPC_URL, MEGA_RPC_URL, BASE_PRIVATE_KEY, MEGA_PRIVATE_KEY, RECIPIENT_ADDRESS

node scripts/deploy-and-mint.cjs
```

**What the script does:**
1. Deploys `Bad_Bunnz` on Base Sepolia and MegaETH
2. Deploys `EthereumBridge` on Base Sepolia
3. Deploys `MegaEthBridge` on MegaETH
4. Wires contracts: sets bridge addresses, links bridges, sets root submitter
5. **Disables ERC721C transfer validator** on both NFTs (required for bridge to receive)
6. Mints initial NFTs to recipient on Base Sepolia

**Manual deployment steps** (if not using script):
1. Deploy `Bad_Bunnz` on both chains
2. Deploy `EthereumBridge` on Base Sepolia
3. Deploy `MegaEthBridge` on MegaETH
4. Set bridge addresses: `badBunnz.setBridgeAddress(bridgeAddress)`
5. Link bridges: `ethBridge.setMegaEthBridge(megaBridgeAddress)` and `megaBridge.setEthereumBridge(ethBridgeAddress)`
6. Set root submitter: `bridge.setRootSubmitter(relayerAddress)` (must match `RELAYER_PRIVATE_KEY`)
7. **Critical**: Disable transfer validator: `badBunnz.setTransferValidator(0x0)` on both chains (or use `scripts/disable-nft-transfer-validator.cjs`)

### Backend Deployment

Deploy to Railway, Cloudflare Workers, or your preferred platform.

**Services to deploy:**
1. Backend API service (includes event listeners and queue processors)
2. PostgreSQL database
3. Redis cache (for job queues)

**Note:** With `AUTO_SUBMIT_ROOTS=true` (default), the backend automatically:
- Submits merkle roots to destination chains
- Calls `unlockNFTWithProof` for each lock (user receives NFT automatically)
- No separate relayer service needed

**Environment setup:**
- Ensure `RELAYER_PRIVATE_KEY` matches the `rootSubmitter` address set in contracts
- Relayer wallet must have gas on both chains (Base Sepolia + MegaETH)
- Use a reliable RPC provider (free tiers may timeout; backend handles this with retries)

## Testing

```bash
# Run Foundry tests
forge test

# Run Hardhat tests
npx hardhat test
```

## Repository Structure

This repository contains:
- `contract/` - Smart contracts (EthereumBridge, MegaEthBridge, Bad_Bunnz)
- `backend/` - Backend services (API, relayer, event listeners, auto-unlock)
- `scripts/` - Deployment and utility scripts
  - `deploy-and-mint.cjs` - Full deployment script (contracts + wiring + minting)
  - `disable-nft-transfer-validator.cjs` - Disable ERC721C validator on existing deployments
- `test/` - Contract tests (Foundry + Hardhat)

**Frontend is in a separate repository** (`bb-bridge-frontend`).

## Scripts

### Deployment

```bash
# Deploy contracts and mint NFTs
node scripts/deploy-and-mint.cjs

# Disable transfer validator on existing deployments (if you didn't use updated deploy script)
node scripts/disable-nft-transfer-validator.cjs
```

### Testing

```bash
# Run Foundry tests
forge test

# Run Hardhat tests
npx hardhat test
```

## Troubleshooting

### "execution reverted" when calling `lockNFT`

**Cause:** ERC721C transfer validator blocking bridge contract from receiving tokens.

**Fix:** Call `setTransferValidator(0x0)` on the Bad_Bunnz contract:
```bash
node scripts/disable-nft-transfer-validator.cjs
```

### "Root already submitted for block"

**Cause:** Relayer tried to submit a root that was already on-chain (e.g. from previous run or manual submission).

**Fix:** Already handled - backend checks on-chain first and skips duplicate submissions. If you see this error, it's harmless; the relayer will mark it as submitted and continue.

### "Proof not found" or "Unexpected end of JSON input"

**Cause:** For single-lock blocks, the merkle proof is an empty array `[]` (single-leaf tree). Old code threw on empty proof.

**Fix:** Already fixed - backend now handles empty proofs correctly. Empty proof is valid when there's only one lock in a block.

### NFT never arrives on destination chain

**Check:**
1. Is `AUTO_SUBMIT_ROOTS=true` in backend env?
2. Does relayer wallet have gas on destination chain?
3. Check `lock_events` table: is `status` stuck at `root_submitted`?
4. Check `block_roots` table: is `submitted = true` for that block?
5. Check `unlock_events` table: is there an unlock tx for that `lock_hash`?

**Fix:** If root is submitted but no unlock event:
- Relayer should auto-unlock after root submission
- Check relayer logs for unlock errors
- Manually trigger unlock via API or relayer method if needed

### RPC timeout errors

**Cause:** Free-tier RPC providers have rate limits and timeouts.

**Fix:** Already handled - backend uses small batches (10 blocks on Base) and retries one-by-one on timeout. For better performance, upgrade to a paid RPC tier.

### Missing blocks / NFT stuck

**Cause:** Event listener skipped a block (should never happen with current code).

**Check:** Query `lock_events` for locks without corresponding `merkle_proofs` or `unlock_events`.

**Fix:** 
- Backend automatically catches up on startup
- If a block was missed, set `block_roots.submitted = false` for that block to trigger reprocessing
- Or manually call relayer's `processUnlocksForBlock` for that block

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Security

See [SECURITY.md](./SECURITY.md) for security policy and vulnerability reporting.
