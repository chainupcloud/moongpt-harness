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
