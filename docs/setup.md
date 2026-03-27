# Setup & Configuration Guide

## Test Environment

### Test Network

| Item | Value |
|------|-------|
| Network | Ethereum Sepolia (testnet) |
| chainId | `11155111` |
| Hyperliquid testnet RPC | `https://hyperliquid-testnet.xyz/evm` |
| moongpt.ai entry | `https://www.moongpt.ai/trade` |

### Test USDC Mint

Testnet USDC contract (permissionless, any address can mint):

```
Contract: 0x4f1b97893eC3AB8a2aa320927B17e889aa152Ff5
Network: Ethereum Sepolia
Operation: call mint(address, amount)
```

**Mint via ethers.js:**
```javascript
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.org');
const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);
const abi = ['function mint(address to, uint256 amount)'];
const contract = new ethers.Contract(
  '0x4f1b97893eC3AB8a2aa320927B17e889aa152Ff5', abi, wallet
);
// mint 1000 USDC (6 decimals)
await contract.mint(wallet.address, ethers.parseUnits('1000', 6));
```

**Mint via cast:**
```bash
cast send 0x4f1b97893eC3AB8a2aa320927B17e889aa152Ff5 \
  "mint(address,uint256)" YOUR_ADDRESS 1000000000 \
  --rpc-url https://rpc.sepolia.org --private-key YOUR_PRIVATE_KEY
```

### Sepolia ETH Faucets
- https://sepoliafaucet.com
- https://faucet.quicknode.com/ethereum/sepolia
- https://www.alchemy.com/faucets/ethereum-sepolia

---

## dex-ui Playwright Wallet Setup

### Test Wallet

| Field | Value |
|-------|-------|
| Address | `0x70995982bd1C084A78602f755CA8B45a14A6de86` |
| Private key | See `.env` → `TEST_WALLET_PRIVATE_KEY` |
| Sui address | `0x94bd399ad5c05f9237c806c6dc8353ed5bd66a93bdf7c6f8346e6b191287c27c` |
| Chain | Sepolia (chainId 11155111) |

### Session Key (fixed test key)

```
SESSION_PK   = 0xaaaaaabbbbbbccccccddddddeeeeeeffffffff00000011111122222233333344
SESSION_ADDR = 0xD3c72aD2D576d5a562EF0f2445599b60F1Cfe526
```

Before each test, re-approve via DEX API (valid 1h):
- `POST https://dex-api.hifo.one/exchange`, action type: `approveAgent`
- Must include `Origin: https://dex-staging.hifo.one` + `User-Agent` header (Cloudflare 1010 otherwise)
- EIP-712 domain: `{ name:"Hermes-Dex", version:"1", chainId:1, verifyingContract:"0x000...000" }`

### Browser Initialization (must follow this order)

**① `addCookies` — pre-set wagmi connection state** (before `newPage()`):
```javascript
await context.addCookies([{
  name: 'wagmi.store',
  value: JSON.stringify({
    state: {
      connections: { __type: 'Map', value: [['injected', { accounts: [WALLET_ADDR], chainId: 11155111 }]] },
      chainId: 11155111, current: 'injected'
    }, version: 3
  }),
  domain: 'hermes-testnet-git-dev-chainupclouds-projects.vercel.app', path: '/'
}]);
```

**② `addInitScript` — inject localStorage + EIP-6963 provider announcement**:
```javascript
localStorage.setItem('dex:eth_to_sui:' + walletAddrLower, SUI_ADDR);
localStorage.setItem('dex:session_key:' + walletAddrLower, JSON.stringify({
  privateKey: SESSION_PK_WITHOUT_0X, agentAddress: SESSION_ADDR.toLowerCase(),
  masterAddress: walletAddrLower, name: 'uitest',
  createdAt: Date.now(), validUntilMs: Date.now() + 3600000, suiAddress: SUI_ADDR,
}));
localStorage.setItem('@appkit/connection_status', 'connected');
localStorage.setItem('@appkit/active_caip_network_id', 'eip155:11155111');

const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
  detail: Object.freeze({
    info: { uuid: '550e8400-e29b-41d4-a716-446655440000', name: 'MetaMask',
             icon: 'data:image/svg+xml;base64,...', rdns: 'io.metamask' },
    provider: provider
  })
}));
announce();
window.addEventListener('eip6963:requestProvider', announce);
```

**③ `exposeFunction` — provide real signing capability**:
```javascript
await page.exposeFunction('__nodeSignTypedData', async (jsonStr) => { /* ethers v6 signTypedData */ });
await page.exposeFunction('__nodeSignMessage', async (msgHex) => { /* ethers v6 signMessage */ });
```

### Order Parameters

| Parameter | Requirement |
|-----------|-------------|
| price | Near market price (e.g. `50000`), **not `1`**: price×size < $10 disables Long button |
| size | `0.001` (minimum BTC unit) |
| Minimum order | price × size ≥ $10 |

Verified: `price=50000, size=0.001` ($50 order) → Long button enabled, order succeeds.

### Key Notes

1. **EIP-6963 required**: AppKit uses `eip6963:announceProvider` event, not `window.ethereum`
2. **No template interpolation in initScript**: use `JSON.stringify()` to inline variables
3. **Wait after goto**: `waitForTimeout(6000)` after navigation to see wallet address in header
4. **Hide modal before form submit**: `w3m-modal` may block; execute `display:none!important`

---

## PR Automation Workflow

### Architecture

moongpt-harness is a **general-purpose CI/CD automation repo** that connects to multiple projects.

Issues are tracked in each **project repo** (e.g. `chainupcloud/dex-ui`); moongpt-harness owns the pipeline.

### Full Pipeline

```
moongpt-harness discovers issue → opens Issue in project repo
    ↓
Claude Code locates fix, creates PR in project repo (referencing project Issue)
    ↓
PR page → Reviewers → select Copilot
    ↓
Copilot completes review (COMMENTED counts as approved)
    ↓
dex-ui dispatch.yml → repository_dispatch → moongpt-harness pipeline.yml
    ↓
Auto squash merge ✓ → Vercel deploy → commit SHA verify ✓
```

### Workflow Configuration (two-layer)

**Layer 1 — project repo dispatcher** (`chainupcloud/dex-ui` → `.github/workflows/dispatch.yml`):
- Receives `pull_request_review` event → forwards `repository_dispatch` to moongpt-harness
- Required Secret: `HARNESS_DISPATCH_TOKEN`

**Layer 2 — moongpt-harness pipeline** (`.github/workflows/pipeline.yml`):
- Evaluates merge conditions (any APPROVED, or Copilot COMMENTED)
- Squash merges PR, triggers Vercel deploy, polls commit SHA
- Required Secrets: `DEX_UI_TOKEN`, `VERCEL_TOKEN`

### PR Naming Convention

| Type | Format | Example |
|------|--------|---------|
| Bug fix | `fix: {description} (#{issue-id})` | `fix: redirect /app to /trade (#7)` |
| CI/tooling | `ci: {description}` | `ci: dispatch to harness pipeline` |
| Feature | `feat: {description}` | `feat: add market filter` |

### Closing Issues

PR body must include (Issue lives in project repo):
```
closes chainupcloud/dex-ui#{issue-number}
```

This auto-closes the project Issue on squash merge.

### Notes

1. `dispatch.yml` must be on the base branch (`main`) to handle PR events
2. Branch conflicts: `git rebase origin/main` before push
3. After merge: delete fix branch; Issue auto-closes via `closes` keyword
