import { Contract, JsonRpcProvider, Provider, Signer, Wallet, isAddress } from "ethers";
import { EXECUTION_GUARD_ABI, POLICY_MANAGER_ABI } from "./abis.js";
import { getDeploymentStatus } from "./deploymentStatus.js";

export type ChainConfig = {
  rpcUrl: string;
  policyManagerAddress: string;
  executionGuardAddress: string;
  network: string;
};

export function getChainConfig(): ChainConfig | null {
  const deployment = getDeploymentStatus();
  if (!deployment.ready || !deployment.policyManager || !deployment.executionGuard) return null;

  const isLiveArbitrum =
    deployment.chainId === 421614 ||
    deployment.network === "Arbitrum Sepolia" ||
    deployment.network === "arbitrumSepolia";
  if (!isLiveArbitrum) return null;

  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
  return {
    rpcUrl,
    policyManagerAddress: deployment.policyManager,
    executionGuardAddress: deployment.executionGuard,
    network: deployment.network ?? "Arbitrum Sepolia"
  };
}

export function isEthAddress(value: string): boolean {
  return isAddress(value);
}

export function getReadProvider(config: ChainConfig): JsonRpcProvider {
  return new JsonRpcProvider(config.rpcUrl);
}

export function getPolicyContract(config: ChainConfig, runner?: Provider | Signer): Contract {
  return new Contract(config.policyManagerAddress, POLICY_MANAGER_ABI, runner ?? getReadProvider(config));
}

export function getGuardContract(config: ChainConfig, runner?: Provider | Signer): Contract {
  return new Contract(config.executionGuardAddress, EXECUTION_GUARD_ABI, runner ?? getReadProvider(config));
}

export function getOperatorWallet(config: ChainConfig): Wallet | null {
  const privateKey = process.env.OPERATOR_PRIVATE_KEY?.trim() || process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!privateKey) return null;
  return new Wallet(privateKey, getReadProvider(config));
}
