// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PolicyManager
 * @notice Source of truth for treasury spend policy, in two lanes:
 *
 *         1. **Native lane** — caps the chain's native asset (ETH on Arbitrum and
 *            Robinhood Chain) per wallet per day.
 *         2. **Token lane** — caps an ERC-20 (for example USDG, the 6-decimal stablecoin
 *            natively issued on Robinhood Chain) per registered token, per wallet, per day.
 *
 * @dev Both lanes are deny-by-default. A limit of 0 means "this wallet may not move this
 *      asset at all"; uncapped spending must be granted explicitly with `UNLIMITED_LIMIT`.
 *      Treasury pots are held in stablecoins rather than native ETH, so the token lane is
 *      the one most deployments will actually use.
 *
 *      Every policy mutation also advances a hash-chained **policy attestation**
 *      (`policyVersion` / `policyDigest`). Guards stamp each decision with the version and
 *      digest that were in force, so a decision can be replayed against the exact policy
 *      that produced it instead of against "the policy as it happens to look today".
 */
contract PolicyManager is AccessControl, Pausable {
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");

    /**
     * @notice Sentinel meaning "this wallet may spend this asset without a cap".
     * @dev Limits are deny-by-default: a limit of 0 blocks all spending. Unlimited
     *      spending must be granted explicitly with this value so that an unconfigured
     *      wallet can never spend by accident.
     */
    uint256 public constant UNLIMITED_LIMIT = type(uint256).max;

    error ZeroAddressNotAllowed();

    // -------------------------------------------------------------- attestation

    /// @notice Version of the policy currently in force. The genesis policy is version 0
    ///         and each amendment increments it by one.
    uint256 public policyVersion;

    /// @notice Running commitment to the whole policy history. Amendment `n` sets
    ///         `policyDigest = keccak256(abi.encode(previousDigest, n, kind, params))`,
    ///         starting from `genesisSeed`. Because each digest folds in its predecessor,
    ///         any edit to an earlier amendment changes every later digest.
    bytes32 public policyDigest;

    /// @notice Seed of the digest chain: binds the chain id so the same policy history on a
    ///         different chain can never produce the same digest.
    bytes32 public immutable genesisSeed;

    bytes32 public constant KIND_GENESIS = keccak256("genesis");
    bytes32 public constant KIND_PAUSE = keccak256("pause");
    bytes32 public constant KIND_UNPAUSE = keccak256("unpause");
    bytes32 public constant KIND_COUNTERPARTY = keccak256("setCounterparty");
    bytes32 public constant KIND_WALLET_DAILY_LIMIT = keccak256("setWalletDailyLimit");
    bytes32 public constant KIND_TOKEN_REGISTRATION = keccak256("setTokenRegistered");
    bytes32 public constant KIND_TOKEN_COUNTERPARTY = keccak256("setTokenCounterparty");
    bytes32 public constant KIND_TOKEN_DAILY_LIMIT = keccak256("setTokenDailyLimit");

    /// @notice Append-only amendment record. `params` is emitted verbatim so the digest
    ///         chain can be recomputed from logs alone, without trusting this contract.
    event PolicyAmended(
        uint256 indexed version,
        bytes32 digest,
        bytes32 indexed kind,
        bytes params,
        address indexed actor
    );

    // ---------------------------------------------------------------- native lane

    mapping(address => bool) public allowlistedCounterparty;
    mapping(address => uint256) public walletDailyLimitWei;

    event CounterpartyAllowlistUpdated(address indexed counterparty, bool allowed, address indexed actor);
    event WalletDailyLimitUpdated(address indexed wallet, uint256 limitWei, address indexed actor);

    // ----------------------------------------------------------------- token lane

    /// @notice Tokens the guard is allowed to reason about. Anything not registered is
    ///         treated as a plain contract call on the native lane.
    mapping(address => bool) public tokenRegistered;

    /// @notice Per token: who this treasury is allowed to pay (or approve).
    mapping(address token => mapping(address counterparty => bool)) public tokenCounterpartyAllowed;

    /// @notice Per token, per wallet: daily cap in the token's own base units.
    mapping(address token => mapping(address wallet => uint256)) public tokenDailyLimit;

    event TokenRegistrationUpdated(address indexed token, bool registered, address indexed actor);
    event TokenCounterpartyUpdated(
        address indexed token,
        address indexed counterparty,
        bool allowed,
        address indexed actor
    );
    event TokenDailyLimitUpdated(
        address indexed token,
        address indexed wallet,
        uint256 limit,
        address indexed actor
    );

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddressNotAllowed();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POLICY_ADMIN_ROLE, admin);

        genesisSeed = keccak256(abi.encodePacked("arb-guardian.policy.genesis", block.chainid));
        policyDigest = genesisSeed;
        _amendPolicy(KIND_GENESIS, abi.encode(admin));
    }

    // ------------------------------------------------------------------- circuit

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _amendPolicy(KIND_PAUSE, abi.encode(msg.sender));
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _amendPolicy(KIND_UNPAUSE, abi.encode(msg.sender));
        _unpause();
    }

    // -------------------------------------------------------------- native lane

    function setCounterparty(address counterparty, bool allowed) external onlyRole(POLICY_ADMIN_ROLE) whenNotPaused {
        if (counterparty == address(0)) revert ZeroAddressNotAllowed();
        allowlistedCounterparty[counterparty] = allowed;
        _amendPolicy(KIND_COUNTERPARTY, abi.encode(counterparty, allowed));
        emit CounterpartyAllowlistUpdated(counterparty, allowed, msg.sender);
    }

    /**
     * @notice Set a wallet's native-asset daily cap.
     * @dev `limitWei == 0` means the wallet may not spend native value at all
     *      (deny-by-default). Pass `UNLIMITED_LIMIT` to grant uncapped spending explicitly.
     */
    function setWalletDailyLimit(address wallet, uint256 limitWei) external onlyRole(POLICY_ADMIN_ROLE) whenNotPaused {
        if (wallet == address(0)) revert ZeroAddressNotAllowed();
        walletDailyLimitWei[wallet] = limitWei;
        _amendPolicy(KIND_WALLET_DAILY_LIMIT, abi.encode(wallet, limitWei));
        emit WalletDailyLimitUpdated(wallet, limitWei, msg.sender);
    }

    // --------------------------------------------------------------- token lane

    /**
     * @notice Register (or unregister) an ERC-20 the guard should enforce token policy on.
     * @dev On Robinhood Chain, USDG is the expected first entry: it is the chain's
     *      natively issued stablecoin and the lending asset in Robinhood Earn.
     */
    function setTokenRegistered(address token, bool registered) external onlyRole(POLICY_ADMIN_ROLE) whenNotPaused {
        if (token == address(0)) revert ZeroAddressNotAllowed();
        tokenRegistered[token] = registered;
        _amendPolicy(KIND_TOKEN_REGISTRATION, abi.encode(token, registered));
        emit TokenRegistrationUpdated(token, registered, msg.sender);
    }

    function setTokenCounterparty(
        address token,
        address counterparty,
        bool allowed
    ) external onlyRole(POLICY_ADMIN_ROLE) whenNotPaused {
        if (token == address(0) || counterparty == address(0)) revert ZeroAddressNotAllowed();
        tokenCounterpartyAllowed[token][counterparty] = allowed;
        _amendPolicy(KIND_TOKEN_COUNTERPARTY, abi.encode(token, counterparty, allowed));
        emit TokenCounterpartyUpdated(token, counterparty, allowed, msg.sender);
    }

    /**
     * @notice Set a wallet's daily cap for a specific token, in the token's base units.
     * @dev `limit == 0` means the wallet may not move this token at all (deny-by-default).
     *      Pass `UNLIMITED_LIMIT` to grant uncapped spending explicitly.
     */
    function setTokenDailyLimit(
        address token,
        address wallet,
        uint256 limit
    ) external onlyRole(POLICY_ADMIN_ROLE) whenNotPaused {
        if (token == address(0) || wallet == address(0)) revert ZeroAddressNotAllowed();
        tokenDailyLimit[token][wallet] = limit;
        _amendPolicy(KIND_TOKEN_DAILY_LIMIT, abi.encode(token, wallet, limit));
        emit TokenDailyLimitUpdated(token, wallet, limit, msg.sender);
    }

    // -------------------------------------------------------------------- views

    /// @notice Convenience check used by the guards' routing logic.
    function isRegisteredToken(address token) external view returns (bool) {
        return tokenRegistered[token];
    }

    /// @notice The policy version and digest in force right now. Guards call this once per
    ///         decision so the emitted decision record names the exact policy that judged it.
    function policySnapshot() external view returns (uint256 version, bytes32 digest) {
        return (policyVersion, policyDigest);
    }

    // ---------------------------------------------------------------- internal

    /**
     * @dev Advance the attestation chain. Genesis (where `policyDigest` is still the seed)
     *      records version 0; every later amendment increments the version by one.
     */
    function _amendPolicy(bytes32 kind, bytes memory params) internal {
        if (policyDigest != genesisSeed) {
            policyVersion += 1;
        }
        policyDigest = keccak256(abi.encode(policyDigest, policyVersion, kind, params));
        emit PolicyAmended(policyVersion, policyDigest, kind, params, msg.sender);
    }
}
