# 测试环境配置

## 测试网信息

| 项目 | 值 |
|------|-----|
| 网络 | Ethereum Sepolia（测试网） |
| chainId | `11155111` |
| Hyperliquid testnet RPC | `https://hyperliquid-testnet.xyz/evm` |
| moongpt.ai 入口 | `https://www.moongpt.ai/trade` |

## 测试 USDC Mint

测试网 USDC 合约（无权限，任意地址可 mint）：

```
合约地址：0x4f1b97893eC3AB8a2aa320927B17e889aa152Ff5
网络：Ethereum Sepolia
操作：调用 mint(address, amount) 即可获得测试 USDC
```

**通过代码 mint 示例（ethers.js）：**

```javascript
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.org');
const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

const abi = ['function mint(address to, uint256 amount)'];
const contract = new ethers.Contract(
  '0x4f1b97893eC3AB8a2aa320927B17e889aa152Ff5',
  abi,
  wallet
);

// mint 1000 USDC（假设 6 位小数）
await contract.mint(wallet.address, ethers.parseUnits('1000', 6));
```

**通过 cast 命令 mint：**

```bash
cast send 0x4f1b97893eC3AB8a2aa320927B17e889aa152Ff5 \
  "mint(address,uint256)" \
  YOUR_ADDRESS 1000000000 \
  --rpc-url https://rpc.sepolia.org \
  --private-key YOUR_PRIVATE_KEY
```

## Sepolia ETH 水龙头（用于支付 gas）

- https://sepoliafaucet.com
- https://faucet.quicknode.com/ethereum/sepolia
- https://www.alchemy.com/faucets/ethereum-sepolia

---

## dex-ui Playwright 钱包连接流程

> 以下仅适用于 dex-ui 项目的 UI 自动化测试。

### 测试钱包

| 字段 | 值 |
|------|----|
| 地址 | `0x70995982bd1C084A78602f755CA8B45a14A6de86` |
| 私钥 | 见 `.env` 中 `TEST_WALLET_PRIVATE_KEY` |
| Sui 地址 | `0x94bd399ad5c05f9237c806c6dc8353ed5bd66a93bdf7c6f8346e6b191287c27c` |
| 链 | Sepolia（chainId 11155111） |

### Session Key（固定测试用）

```
SESSION_PK   = 0xaaaaaabbbbbbccccccddddddeeeeeeffffffff00000011111122222233333344
SESSION_ADDR = 0xD3c72aD2D576d5a562EF0f2445599b60F1Cfe526
```

每次测试前必须通过 DEX API 重新 approve（有效期 1 小时）：
- `POST https://dex-api.hifo.one/exchange`，action type：`approveAgent`
- **必须携带** `Origin: https://dex-staging.hifo.one` + `User-Agent` header，否则 Cloudflare 1010 拒绝
- EIP-712 domain：`{ name:"Hermes-Dex", version:"1", chainId:1, verifyingContract:"0x000...000" }`

### 浏览器初始化（必须按顺序）

**① 在 `addCookies` 中预设 wagmi 连接状态**（`newPage()` 之前）：
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

**② `addInitScript` 中预填 localStorage + EIP-6963 provider 公告**：
```javascript
// localStorage
localStorage.setItem('dex:eth_to_sui:' + walletAddrLower, SUI_ADDR);
localStorage.setItem('dex:session_key:' + walletAddrLower, JSON.stringify({
  privateKey: SESSION_PK_WITHOUT_0X, agentAddress: SESSION_ADDR.toLowerCase(),
  masterAddress: walletAddrLower, name: 'uitest',
  createdAt: Date.now(), validUntilMs: Date.now() + 3600000, suiAddress: SUI_ADDR,
}));
localStorage.setItem('@appkit/connection_status', 'connected');
localStorage.setItem('@appkit/active_caip_network_id', 'eip155:11155111');

// EIP-6963（AppKit/wagmi 的钱包检测协议，window.ethereum 单独设置不够）
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

**③ `exposeFunction` 提供真实签名能力**：
```javascript
await page.exposeFunction('__nodeSignTypedData', async (jsonStr) => { /* ethers v6 signTypedData */ });
await page.exposeFunction('__nodeSignMessage', async (msgHex) => { /* ethers v6 signMessage */ });
```

### 下单参数要求

| 参数 | 要求 |
|------|------|
| price | 接近市价（如 `50000`），**不能用 `1`**：price × size < $10 则 Long 按钮 disabled |
| size | `0.001`（最小 BTC 单位） |
| 最低订单金额 | price × size ≥ $10 |

已验证参数：`price=50000, size=0.001`（订单金额 $50）→ Long 按钮可用，下单成功。

### 关键注意事项

1. **EIP-6963 必须实现**：AppKit 不靠 `window.ethereum` 自动重连，靠 `eip6963:announceProvider` 事件
2. **initScript 禁用模板插值 `${}`**：用 `JSON.stringify()` 内联变量，避免 shell/node 展开
3. **wagmi 重连需等待**：`goto` 后 `waitForTimeout(6000)` 才能看到 header 中的钱包地址
4. **提交表单前 force-hide modal**：`w3m-modal` 可能遮挡，执行 `display:none!important`
5. **参考脚本**：`/tmp/pw-test/ui-order-test5.js`（已验证，2026-03-26）
