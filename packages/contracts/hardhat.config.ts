import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";

dotenv.config({ path: "../../.env" });
dotenv.config();

const ARBITRUM_SEPOLIA_RPC_URL =
  process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";
const ROBINHOOD_TESTNET_RPC_URL =
  process.env.ROBINHOOD_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";

/**
 * Explorer verification.
 *
 * Both explorers are Etherscan-API compatible, so `hardhat verify` works against them.
 * Robinhood Chain is registered as a custom chain; its explorer is Blockscout-backed.
 * Keys are read from the environment so nothing secret lives in the repo.
 */
const etherscanApiKey: Record<string, string> = {
  arbitrumSepolia: process.env.ARBISCAN_API_KEY ?? "",
  robinhoodTestnet: process.env.ROBINHOOD_EXPLORER_API_KEY ?? ""
};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.25",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {},
    arbitrumSepolia: {
      url: ARBITRUM_SEPOLIA_RPC_URL,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
    },
    robinhoodTestnet: {
      url: ROBINHOOD_TESTNET_RPC_URL,
      chainId: 46630,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
    }
  },
  etherscan: {
    apiKey: etherscanApiKey,
    customChains: [
      {
        network: "robinhoodTestnet",
        chainId: 46630,
        urls: {
          apiURL: "https://explorer.testnet.chain.robinhood.com/api",
          browserURL: "https://explorer.testnet.chain.robinhood.com"
        }
      }
    ]
  },
  sourcify: {
    // Sourcify is a useful second source of truth for the same bytecode.
    enabled: false
  }
};

export default config;
