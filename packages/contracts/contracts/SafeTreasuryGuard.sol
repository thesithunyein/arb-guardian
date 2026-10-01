// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/Enum.sol";
import "./interfaces/ITransactionGuard.sol";
import "./PolicyManager.sol";
import "./libraries/TokenCalldata.sol";

/**
 * @title SafeTreasuryGuard
 * @notice Gnosis Safe-compatible transaction guard that enforces Arb Guardian policy
 *         before a Safe executes a transaction. This is the production integration path
 *         for treasury multisigs on Arbitrum and Robinhood Chain.
 *
 * @dev Routing, in order:
 *
 *      1. **Self-call** (`to == msg.sender`) — an owner-approved configuration change to the
 *         Safe itself (guard, modules, owners). Gated by the Safe's own threshold, so it is
 *         allowed through; native value on such a call still follows policy.
 *      2. **Registered token** (`to` is a registered ERC-20, e.g. USDG) — the calldata is
 *         decoded and the *token* policy applies: recipient (or spender) must be allowlisted
 *         for that token, the movement must fit the token's daily cap, standing approvals are
 *         rejected, and an unrecognised selector on a registered token is rejected rather
 *         than silently allowed.
 *      3. **Everything else** — native lane: the destination must be allowlisted and any
 *         native value counts against the native daily cap.
 *
 *      Both lanes are deny-by-default, and spend is recorded before execution so the cap
 *      cannot be bypassed by re-entrancy.
 *
 *      Each checked transaction is also stamped with the `PolicyManager` policy version and
 *      digest that judged it, so an executed transfer can be reconciled against the exact
 *      policy in force at that block rather than the policy as it looks later.
 */
contract SafeTreasuryGuard is AccessControl, ITransactionGuard {
    bytes32 public constant GUARD_ADMIN_ROLE = keccak256("GUARD_ADMIN_ROLE");

    PolicyManager public immutable policyManager;

    // --------------------------------------------------------------- native lane

    mapping(address => uint256) public safeSpentTodayWei;
    mapping(address => uint256) public safeSpentDayIndex;
    mapping(address => bool) public enrolledSafe;

    /// @notice Native spend recorded for the in-flight Safe transaction, refunded if it fails.
    mapping(address => uint256) public pendingSpendWei;

    event SafeSpendReset(address indexed safe, uint256 dayIndex);
    event SafeSpendRefunded(address indexed safe, uint256 amountWei);

    // ---------------------------------------------------------------- token lane

    mapping(address token => mapping(address safe => uint256)) public safeTokenSpentToday;
    mapping(address token => mapping(address safe => uint256)) public safeTokenSpentDayIndex;

    /// @notice Token recorded for the in-flight Safe transaction, refunded if it fails.
    mapping(address => address) public pendingToken;
    mapping(address => uint256) public pendingTokenSpend;

    event SafeTokenSpendReset(address indexed token, address indexed safe, uint256 dayIndex);
    event SafeTokenSpendRefunded(address indexed token, address indexed safe, uint256 amount);

    // ------------------------------------------------------------------- events

    event SafeEnrollmentUpdated(address indexed safe, bool enrolled, address indexed actor);
    event SafeTxChecked(
        address indexed safe,
        address indexed to,
        uint256 value,
        bytes4 selector,
        bool blocked,
        string reason,
        uint256 policyVersion,
        bytes32 policyDigest
    );
    event SafeTokenTxChecked(
        address indexed token,
        address indexed safe,
        address indexed counterparty,
        uint256 amount,
        bytes4 selector,
        bool blocked,
        string reason,
        uint256 policyVersion,
        bytes32 policyDigest
    );

    // ------------------------------------------------------------------- errors

    error ZeroAddressNotAllowed();
    error SafeNotEnrolled(address safe);
    error DelegateCallNotAllowed();
    error CounterpartyNotAllowlisted(address destination);
    error DailyLimitExceeded(address safe, uint256 attemptedAmount, uint256 limit);
    error DailyLimitNotConfigured(address safe);
    error PolicyManagerPaused();
    error GuardPaused();

    error TokenNotRegistered(address token);
    error TokenCounterpartyNotAllowlisted(address token, address counterparty);
    error TokenDailyLimitNotConfigured(address token, address safe);
    error TokenDailyLimitExceeded(address token, address safe, uint256 attemptedAmount, uint256 limit);
    error ApprovalNotAllowed(address token, address spender, uint256 amount);
    error TransferFromSourceNotSafe(address token, address source, address safe);
    error UnsupportedTokenCall(address token, bytes4 selector);
    error InvalidAmount();

    bool public paused;

    constructor(address admin, address policyManagerAddress) {
        if (admin == address(0) || policyManagerAddress == address(0)) revert ZeroAddressNotAllowed();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARD_ADMIN_ROLE, admin);
        policyManager = PolicyManager(policyManagerAddress);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = true;
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = false;
    }

    function setSafeEnrollment(address safe, bool enrolled) external onlyRole(GUARD_ADMIN_ROLE) {
        if (safe == address(0)) revert ZeroAddressNotAllowed();
        enrolledSafe[safe] = enrolled;
        emit SafeEnrollmentUpdated(safe, enrolled, msg.sender);
    }

    /**
     * @dev Called by a Safe during execTransaction, before execution.
     *      `msg.sender` is the Safe address.
     */
    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory,
        address
    ) external override {
        if (paused) revert GuardPaused();
        if (policyManager.paused()) revert PolicyManagerPaused();
        if (!enrolledSafe[msg.sender]) revert SafeNotEnrolled(msg.sender);
        if (operation == Enum.Operation.DelegateCall) revert DelegateCallNotAllowed();
        if (to == address(0)) revert ZeroAddressNotAllowed();

        (uint256 policyVersion, bytes32 policyDigest) = policyManager.policySnapshot();

        bytes4 selector = data.length >= 4 ? bytes4(data) : bytes4(0);

        // Clear any stale in-flight record before recording this transaction.
        pendingSpendWei[msg.sender] = 0;
        pendingToken[msg.sender] = address(0);
        pendingTokenSpend[msg.sender] = 0;

        if (to == msg.sender) {
            // Owner-approved change to the Safe's own configuration. No destination policy
            // applies (the destination is the Safe), but native value still follows policy.
            if (value > 0) {
                _recordNativeSpend(msg.sender, to, value, selector);
            }
            emit SafeTxChecked(msg.sender, to, value, selector, false, "self_call_allowed", policyVersion, policyDigest);
            return;
        }

        if (policyManager.tokenRegistered(to)) {
            _checkRegisteredToken(msg.sender, to, data, selector);
        } else if (!policyManager.allowlistedCounterparty(to)) {
            emit SafeTxChecked(msg.sender, to, value, selector, true, "counterparty_not_allowlisted", policyVersion, policyDigest);
            revert CounterpartyNotAllowlisted(to);
        }

        // A token call may also carry native value; enforce both lanes.
        if (value > 0) {
            _recordNativeSpend(msg.sender, to, value, selector);
        }

        emit SafeTxChecked(msg.sender, to, value, selector, false, "allowed", policyVersion, policyDigest);
    }

    /**
     * @dev Spend is recorded before execution so the cap cannot be bypassed by
     *      re-entrancy. If the Safe's inner call failed, give the budget back so a
     *      failed transaction does not silently consume the daily allowance.
     */
    function checkAfterExecution(bytes32, bool success) external override {
        uint256 pendingNative = pendingSpendWei[msg.sender];
        address token = pendingToken[msg.sender];
        uint256 pendingTokenAmount = pendingTokenSpend[msg.sender];

        pendingSpendWei[msg.sender] = 0;
        pendingToken[msg.sender] = address(0);
        pendingTokenSpend[msg.sender] = 0;

        if (success) return;

        if (pendingNative > 0) {
            uint256 spent = safeSpentTodayWei[msg.sender];
            uint256 refunded = pendingNative > spent ? spent : pendingNative;
            safeSpentTodayWei[msg.sender] = spent - refunded;
            emit SafeSpendRefunded(msg.sender, refunded);
        }

        if (token != address(0) && pendingTokenAmount > 0) {
            uint256 spentToken = safeTokenSpentToday[token][msg.sender];
            uint256 refundedToken = pendingTokenAmount > spentToken ? spentToken : pendingTokenAmount;
            safeTokenSpentToday[token][msg.sender] = spentToken - refundedToken;
            emit SafeTokenSpendRefunded(token, msg.sender, refundedToken);
        }
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(ITransactionGuard).interfaceId || super.supportsInterface(interfaceId);
    }

    // ------------------------------------------------------------------ internal

    function _checkRegisteredToken(address safe, address token, bytes memory data, bytes4 selector) internal {
        (uint256 policyVersion, bytes32 policyDigest) = policyManager.policySnapshot();
        if (TokenCalldata.isTransfer(selector)) {
            address from;
            address recipient;
            uint256 amount;
            if (selector == TokenCalldata.TRANSFER) {
                (recipient, amount) = TokenCalldata.decodeTransfer(data);
            } else {
                (from, recipient, amount) = TokenCalldata.decodeTransferFrom(data);
                if (from != safe) {
                    revert TransferFromSourceNotSafe(token, from, safe);
                }
            }
            if (recipient == address(0)) revert ZeroAddressNotAllowed();

            if (!policyManager.tokenCounterpartyAllowed(token, recipient)) {
                emit SafeTokenTxChecked(token, safe, recipient, amount, selector, true, "recipient_not_allowlisted", policyVersion, policyDigest);
                revert TokenCounterpartyNotAllowlisted(token, recipient);
            }

            _recordTokenSpend(safe, token, recipient, amount, selector);
            return;
        }

        if (TokenCalldata.isApproval(selector)) {
            (address spender, uint256 amount) = TokenCalldata.decodeApproval(data);
            if (spender == address(0)) revert ZeroAddressNotAllowed();

            if (!policyManager.tokenCounterpartyAllowed(token, spender)) {
                emit SafeTokenTxChecked(token, safe, spender, amount, selector, true, "spender_not_allowlisted", policyVersion, policyDigest);
                revert TokenCounterpartyNotAllowlisted(token, spender);
            }

            // Any standing approval can be exercised later by the spender without a Safe
            // transaction, so it would sit outside this guard's daily-cap accounting.
            emit SafeTokenTxChecked(token, safe, spender, amount, selector, true, "approval_not_allowed", policyVersion, policyDigest);
            revert ApprovalNotAllowed(token, spender, amount);
        }

        // Registered token, unrecognised selector: reject rather than fall through to the
        // native lane, which would otherwise let a non-standard call bypass the token cap.
        emit SafeTokenTxChecked(token, safe, address(0), 0, selector, true, "unsupported_token_call", policyVersion, policyDigest);
        revert UnsupportedTokenCall(token, selector);
    }

    function _recordNativeSpend(address safe, address to, uint256 value, bytes4 selector) internal {
        (uint256 policyVersion, bytes32 policyDigest) = policyManager.policySnapshot();
        _resetDailySpendIfNeeded(safe);

        // Deny-by-default: an unconfigured Safe (limit 0) cannot spend. Uncapped
        // spending must be granted explicitly via PolicyManager.UNLIMITED_LIMIT.
        uint256 dailyLimit = policyManager.walletDailyLimitWei(safe);
        if (dailyLimit == 0) {
            emit SafeTxChecked(safe, to, value, selector, true, "daily_limit_not_configured", policyVersion, policyDigest);
            revert DailyLimitNotConfigured(safe);
        }

        uint256 newTotal = safeSpentTodayWei[safe] + value;
        if (newTotal > dailyLimit) {
            emit SafeTxChecked(safe, to, value, selector, true, "daily_limit_exceeded", policyVersion, policyDigest);
            revert DailyLimitExceeded(safe, newTotal, dailyLimit);
        }

        safeSpentTodayWei[safe] = newTotal;
        pendingSpendWei[safe] = value;
    }

    function _recordTokenSpend(
        address safe,
        address token,
        address recipient,
        uint256 amount,
        bytes4 selector
    ) internal {
        (uint256 policyVersion, bytes32 policyDigest) = policyManager.policySnapshot();
        _resetTokenSpendIfNeeded(token, safe);

        uint256 limit = policyManager.tokenDailyLimit(token, safe);
        if (limit == 0) {
            emit SafeTokenTxChecked(token, safe, recipient, amount, selector, true, "daily_limit_not_configured", policyVersion, policyDigest);
            revert TokenDailyLimitNotConfigured(token, safe);
        }

        uint256 newTotal = safeTokenSpentToday[token][safe] + amount;
        if (newTotal > limit) {
            emit SafeTokenTxChecked(token, safe, recipient, amount, selector, true, "daily_limit_exceeded", policyVersion, policyDigest);
            revert TokenDailyLimitExceeded(token, safe, newTotal, limit);
        }

        safeTokenSpentToday[token][safe] = newTotal;
        pendingToken[safe] = token;
        pendingTokenSpend[safe] = amount;

        emit SafeTokenTxChecked(token, safe, recipient, amount, selector, false, "allowed", policyVersion, policyDigest);
    }

    function _resetDailySpendIfNeeded(address safe) internal {
        uint256 currentDayIndex = block.timestamp / 1 days;
        if (safeSpentDayIndex[safe] != currentDayIndex) {
            safeSpentDayIndex[safe] = currentDayIndex;
            safeSpentTodayWei[safe] = 0;
            emit SafeSpendReset(safe, currentDayIndex);
        }
    }

    function _resetTokenSpendIfNeeded(address token, address safe) internal {
        uint256 currentDayIndex = block.timestamp / 1 days;
        if (safeTokenSpentDayIndex[token][safe] != currentDayIndex) {
            safeTokenSpentDayIndex[token][safe] = currentDayIndex;
            safeTokenSpentToday[token][safe] = 0;
            emit SafeTokenSpendReset(token, safe, currentDayIndex);
        }
    }
}
