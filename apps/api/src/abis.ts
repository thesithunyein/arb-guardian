/**
 * The API used to keep its own hand-written ABI fragments here. They had already drifted:
 * this copy predated the token lane and the policy attestation, so it could not see the
 * functions the contracts now expose. The ABI lives in `@arb-guardian/shared` with the rest
 * of the policy client, and this module only re-exports it so existing imports keep working.
 */
export { EXECUTION_GUARD_ABI, POLICY_MANAGER_ABI, policyManager, executionGuard } from "@arb-guardian/shared";
