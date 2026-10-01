// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./PolicyManager.sol";

/**
 * @title ExecutionGuard
 * @notice Operator-facing pre-execution validation for treasury spend, in two lanes:
 *         native value, and registered ERC-20 tokens (e.g. USDG on Robinhood Chain).
 *
 * @dev This contract is a policy oracle: it validates and records spend so the operator
 *      API and the UI share one source of truth. It holds no funds and cannot move any.
 *      Hard enforcement for a multisig treasury happens in `SafeTreasuryGuard`, which
 *      runs inside a real Gnosis Safe's `execTransaction`.
 *
 *      Every decision record carries the `PolicyManager` version and digest that judged it
 *      (see `PolicyManager.policySnapshot`). That makes a decision independently
 *      re-checkable against the policy actually in force at the time, and makes the
 *      amendment log tamper-evident: editing history changes the digest chain.
 */
contract ExecutionGuard is AccessControl, Pausable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    PolicyManager public immutable policyManager;

    // --------------------------------------------------------------- native lane

    mapping(address => uint256) public walletSpentTodayWei;
    mapping(address => uint256) public walletSpentDayIndex;

    event TransactionValidated(
        address indexed wallet,
        address indexed destination,
        uint256 amountWei,
        bytes4 methodSelector,
        bool blocked,
        string reason,
        address indexed actor,
        uint256 policyVersion,
        bytes32 policyDigest
    );

    event WalletSpendReset(address indexed wallet, uint256 dayIndex);

    error CounterpartyNotAllowlisted(address destination);
    error DailyLimitExceeded(address wallet, uint256 attemptedAmount, uint256 limit);
    error DailyLimitNotConfigured(address wallet);
    error ZeroAddressNotAllowed();
    error InvalidAmount();
    error PolicyManagerPaused();

    // ---------------------------------------------------------------- token lane

    mapping(address token => mapping(address wallet => uint256)) public walletTokenSpentToday;
    mapping(address token => mapping(address wallet => uint256)) public walletTokenSpentDayIndex;

    event TokenTransferValidated(
        address indexed token,
        address indexed wallet,
        address indexed recipient,
        uint256 amount,
        bytes4 methodSelector,
        bool blocked,
        string reason,
        address actor,
        uint256 policyVersion,
        bytes32 policyDigest
    );

    event TokenApprovalValidated(
        address indexed token,
        address indexed wallet,
        address indexed spender,
        uint256 amount,
        bytes4 methodSelector,
        bool blocked,
        string reason,
        address actor,
        uint256 policyVersion,
        bytes32 policyDigest
    );

    event WalletTokenSpendReset(address indexed token, address indexed wallet, uint256 dayIndex);

    error TokenNotRegistered(address token);
    error TokenCounterpartyNotAllowlisted(address token, address counterparty);
    error TokenDailyLimitNotConfigured(address token, address wallet);
    error TokenDailyLimitExceeded(address token, address wallet, uint256 attemptedAmount, uint256 limit);
    error UnlimitedApprovalNotAllowed(address token, address spender);

    constructor(address admin, address policyManagerAddress) {
        if (admin == address(0) || policyManagerAddress == address(0)) revert ZeroAddressNotAllowed();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        policyManager = PolicyManager(policyManagerAddress);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // --------------------------------------------------------------- native lane

    function validateAndRecord(
        address wallet,
        address destination,
        uint256 amountWei,
        bytes4 methodSelector
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused returns (bool allowed, string memory reason) {
        if (wallet == address(0) || destination == address(0)) revert ZeroAddressNotAllowed();
        if (amountWei == 0) revert InvalidAmount();
        if (policyManager.paused()) revert PolicyManagerPaused();

        (uint256 policyVersion, bytes32 policyDigest) = policyManager.policySnapshot();

        if (!policyManager.allowlistedCounterparty(destination)) {
            emit TransactionValidated(wallet, destination, amountWei, methodSelector, true, "counterparty_not_allowlisted", msg.sender, policyVersion, policyDigest);
            revert CounterpartyNotAllowlisted(destination);
        }

        _resetDailySpendIfNeeded(wallet);

        // Deny-by-default: an unconfigured wallet (limit 0) cannot spend. Uncapped
        // spending must be granted explicitly via PolicyManager.UNLIMITED_LIMIT.
        uint256 dailyLimit = policyManager.walletDailyLimitWei(wallet);
        if (dailyLimit == 0) {
            emit TransactionValidated(wallet, destination, amountWei, methodSelector, true, "daily_limit_not_configured", msg.sender, policyVersion, policyDigest);
            revert DailyLimitNotConfigured(wallet);
        }

        uint256 newTotal = walletSpentTodayWei[wallet] + amountWei;
        if (newTotal > dailyLimit) {
            emit TransactionValidated(wallet, destination, amountWei, methodSelector, true, "daily_limit_exceeded", msg.sender, policyVersion, policyDigest);
            revert DailyLimitExceeded(wallet, newTotal, dailyLimit);
        }

        walletSpentTodayWei[wallet] = newTotal;
        emit TransactionValidated(wallet, destination, amountWei, methodSelector, false, "allowed", msg.sender, policyVersion, policyDigest);
        return (true, "allowed");
    }

    // ---------------------------------------------------------------- token lane

    /**
     * @notice Validate a token movement (transfer / transferFrom) against the token cap.
     * @dev Amounts are in the token's own base units. USDG uses 6 decimals, so a
     *      $5,000 daily cap is `5_000 * 10**6`.
     */
    function validateTokenTransfer(
        address wallet,
        address token,
        address recipient,
        uint256 amount,
        bytes4 methodSelector
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused returns (bool allowed, string memory reason) {
        if (wallet == address(0) || token == address(0) || recipient == address(0)) revert ZeroAddressNotAllowed();
        if (amount == 0) revert InvalidAmount();
        if (policyManager.paused()) revert PolicyManagerPaused();

        (uint256 policyVersion, bytes32 policyDigest) = policyManager.policySnapshot();

        if (!policyManager.tokenRegistered(token)) {
            emit TokenTransferValidated(token, wallet, recipient, amount, methodSelector, true, "token_not_registered", msg.sender, policyVersion, policyDigest);
            revert TokenNotRegistered(token);
        }

        if (!policyManager.tokenCounterpartyAllowed(token, recipient)) {
            emit TokenTransferValidated(token, wallet, recipient, amount, methodSelector, true, "counterparty_not_allowlisted", msg.sender, policyVersion, policyDigest);
            revert TokenCounterpartyNotAllowlisted(token, recipient);
        }

        _resetTokenSpendIfNeeded(token, wallet);

        uint256 limit = policyManager.tokenDailyLimit(token, wallet);
        if (limit == 0) {
            emit TokenTransferValidated(token, wallet, recipient, amount, methodSelector, true, "daily_limit_not_configured", msg.sender, policyVersion, policyDigest);
            revert TokenDailyLimitNotConfigured(token, wallet);
        }

        uint256 newTotal = walletTokenSpentToday[token][wallet] + amount;
        if (newTotal > limit) {
            emit TokenTransferValidated(token, wallet, recipient, amount, methodSelector, true, "daily_limit_exceeded", msg.sender, policyVersion, policyDigest);
            revert TokenDailyLimitExceeded(token, wallet, newTotal, limit);
        }

        walletTokenSpentToday[token][wallet] = newTotal;
        emit TokenTransferValidated(token, wallet, recipient, amount, methodSelector, false, "allowed", msg.sender, policyVersion, policyDigest);
        return (true, "allowed");
    }

    /**
     * @notice Validate an approval-class call (approve / increaseAllowance).
     * @dev An approval grants standing authority rather than moving value, so it does not
     *      consume the daily cap. It is still constrained: the spender must be explicitly
     *      allowlisted for that token, and an unlimited approval is rejected outright.
     */
    function validateTokenApproval(
        address wallet,
        address token,
        address spender,
        uint256 amount,
        bytes4 methodSelector
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused returns (bool allowed, string memory reason) {
        if (wallet == address(0) || token == address(0) || spender == address(0)) revert ZeroAddressNotAllowed();
        if (policyManager.paused()) revert PolicyManagerPaused();

        (uint256 policyVersion, bytes32 policyDigest) = policyManager.policySnapshot();

        if (!policyManager.tokenRegistered(token)) {
            emit TokenApprovalValidated(token, wallet, spender, amount, methodSelector, true, "token_not_registered", msg.sender, policyVersion, policyDigest);
            revert TokenNotRegistered(token);
        }

        if (!policyManager.tokenCounterpartyAllowed(token, spender)) {
            emit TokenApprovalValidated(token, wallet, spender, amount, methodSelector, true, "spender_not_allowlisted", msg.sender, policyVersion, policyDigest);
            revert TokenCounterpartyNotAllowlisted(token, spender);
        }

        if (amount == type(uint256).max) {
            emit TokenApprovalValidated(token, wallet, spender, amount, methodSelector, true, "unlimited_approval", msg.sender, policyVersion, policyDigest);
            revert UnlimitedApprovalNotAllowed(token, spender);
        }

        emit TokenApprovalValidated(token, wallet, spender, amount, methodSelector, false, "allowed", msg.sender, policyVersion, policyDigest);
        return (true, "allowed");
    }

    // ------------------------------------------------------------------ internal

    function _resetDailySpendIfNeeded(address wallet) internal {
        uint256 currentDayIndex = block.timestamp / 1 days;
        if (walletSpentDayIndex[wallet] != currentDayIndex) {
            walletSpentDayIndex[wallet] = currentDayIndex;
            walletSpentTodayWei[wallet] = 0;
            emit WalletSpendReset(wallet, currentDayIndex);
        }
    }

    function _resetTokenSpendIfNeeded(address token, address wallet) internal {
        uint256 currentDayIndex = block.timestamp / 1 days;
        if (walletTokenSpentDayIndex[token][wallet] != currentDayIndex) {
            walletTokenSpentDayIndex[token][wallet] = currentDayIndex;
            walletTokenSpentToday[token][wallet] = 0;
            emit WalletTokenSpendReset(token, wallet, currentDayIndex);
        }
    }
}
