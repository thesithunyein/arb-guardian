import type * as ethers from "ethers";
import type { FactoryOptions } from "@nomicfoundation/hardhat-ethers/types";

/**
 * Hardhat's `getContractFactory(...)` narrows the deployed contract to
 * `Omit<ethers.Contract, keyof BaseContract>` through the `ContractFactory<'A', 'I'>`
 * generic, which strips the contract's member index signature. Every legitimate call such as
 * `guard.validateAndRecord(...)` in the tests then fails to compile even though it is correct
 * at runtime, and the fix would otherwise be an `as any` at ~40 call sites.
 *
 * This adds one overload that keeps the same runtime behaviour (it is the same function) but
 * types the deployed contract loosely. Typechain is the production answer; this package does
 * not run it, and the contracts themselves are still checked by `hardhat compile` plus solhint.
 */
declare module "@nomicfoundation/hardhat-ethers/types" {
  export function getContractFactory<A extends any[] = any[], I = any>(
    name: string,
    signerOrOptions?: ethers.Signer | FactoryOptions
  ): Promise<ethers.ContractFactory<A, I>>;
}
