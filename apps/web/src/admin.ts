/**
 * Administering the policy the guards enforce.
 *
 * The write calls, the role hashes, the limit semantics and the revert decoding all belong to
 * `@arb-guardian/shared`, which is driven against the real contracts by the contracts suite. This
 * module adds only what a browser brings: the operator's own signer, and a read of "what does this
 * address hold, and what is this treasury's policy right now".
 *
 * Nothing here decides anything. If the console were to compute its own answer about permission
 * or limits, the product would have a second opinion that can drift from the chain — which is the
 * failure this whole codebase is arranged to avoid.
 */
import { BrowserProvider, type Contract, type ContractRunner, type Signer } from "ethers";
import {
  canPerform,
  decodePolicyError,
  detectPolicyAttestation,
  executionGuard,
  explainMissingRole,
  isValidAddress,
  policyManager,
  readPolicyRoles,
  readWalletPolicy,
  type PolicyAttestation,
  type PolicyChange,
  type PolicyHead,
  type PolicyRefusal,
  type PolicyRoles,
  type WalletPolicy
} from "@arb-guardian/shared";
import { EXECUTION_GUARD, POLICY_MANAGER } from "./config";

export { canPerform, explainMissingRole, isValidAddress };
export type { PolicyChange, PolicyHead, PolicyRefusal, PolicyRoles, WalletPolicy };

export function hasInjectedWallet(): boolean {
  const eth = (window as Window & { ethereum?: unknown }).ethereum;
  return Boolean(eth) && typeof eth === "object";
}

export type AdminSigner = { address: string; signer: Signer };

/**
 * Ask the browser wallet for a signer. The operator's own key never reaches the app: every
 * transaction is proposed to the wallet and signed there.
 */
export async function connectAdmin(): Promise<AdminSigner> {
  const eth = (window as Window & { ethereum?: unknown }).ethereum;
  if (!eth || typeof eth !== "object") {
    throw new Error("No browser wallet found. Install one to administer a treasury.");
  }
  const provider = new BrowserProvider(eth as ConstructorParameters<typeof BrowserProvider>[0]);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  return { address: await signer.getAddress(), signer };
}

export function policyContract(runner: ContractRunner): Contract {
  return policyManager(POLICY_MANAGER, runner) as Contract;
}

export function guardContract(runner: ContractRunner): Contract {
  return executionGuard(EXECUTION_GUARD, runner) as Contract;
}

export type AdminView = {
  /** The wallet or treasury whose limits and permissions are being shown. */
  address: string;
  wallet: WalletPolicy;
  /**
   * Detected, not assumed. The live deployment predates the versioned attestation, so the console
   * has to report "this build does not publish one" instead of failing to render the whole page.
   */
  attestation: PolicyAttestation;
  paused: boolean;
  manager: string;
  /** Whose permissions are reported. The operator acting, not the treasury being administered. */
  actor: string | null;
  /** Roles held by `actor`. Empty when nobody is connected — never assumed to be permissive. */
  roles: PolicyRoles;
};

/**
 * One address's policy, plus what the operator may change about it.
 *
 * The roles are read for the operator rather than for the treasury: `hasRole` answers for one
 * address, so reporting the treasury's roles would tell the operator about permissions they might
 * not hold. With no wallet connected this reports no roles at all, which fails closed in the UI.
 */
export async function readAdminView(
  runner: ContractRunner,
  address: string,
  actor: string | null
): Promise<AdminView> {
  const policy = policyContract(runner);
  const guard = guardContract(runner);

  const [wallet, attestation, paused, roles] = await Promise.all([
    readWalletPolicy(policy, guard, address),
    detectPolicyAttestation(policy),
    policy.paused(),
    actor
      ? readPolicyRoles(policy, actor)
      : Promise.resolve({ address: "", policyAdmin: false, defaultAdmin: false })
  ]);

  return {
    address,
    wallet,
    attestation,
    paused: Boolean(paused),
    manager: POLICY_MANAGER,
    actor,
    roles
  };
}

export type ChangeResult =
  | { ok: true; change: PolicyChange }
  | { ok: false; refusal: PolicyRefusal };

/**
 * Send one policy change and turn whatever comes back into something readable: on success the
 * policy head the client read back afterwards, on failure the contract's own reason rather than a
 * stack trace. A refusal here is expected traffic, not an exception.
 */
export async function submitChange(
  runner: ContractRunner,
  run: (policy: Contract) => Promise<PolicyChange>
): Promise<ChangeResult> {
  try {
    return { ok: true, change: await run(policyContract(runner)) };
  } catch (error) {
    return { ok: false, refusal: decodePolicyError(error) };
  }
}
