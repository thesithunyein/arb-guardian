// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/Enum.sol";
import "./interfaces/ITransactionGuard.sol";
import "./PolicyManager.sol";

/**
 * @title SafeTreasuryGuard
 * @notice Gnosis Safe-compatible transaction guard that enforces Arb Guardian policy
 *         before a Safe executes a transaction. This is the production integration path
 *         for treasury multisigs on Arbitrum.
 */
contract SafeTreasuryGuard is AccessControl, ITransactionGuard {
    bytes32 public constant GUARD_ADMIN_ROLE = keccak256("GUARD_ADMIN_ROLE");

    PolicyManager public immutable policyManager;

    mapping(address => uint256) public safeSpentTodayWei;
    mapping(address => uint256) public safeSpentDayIndex;
    mapping(address => bool) public enrolledSafe;

    event SafeEnrollmentUpdated(address indexed safe, bool enrolled, address indexed actor);
    event SafeTxChecked(
        address indexed safe,
        address indexed to,
        uint256 value,
        bytes4 selector,
        bool blocked,
        string reason
    );
    event SafeSpendReset(address indexed safe, uint256 dayIndex);

    error ZeroAddressNotAllowed();
    error SafeNotEnrolled(address safe);
    error DelegateCallNotAllowed();
    error CounterpartyNotAllowlisted(address destination);
    error DailyLimitExceeded(address safe, uint256 attemptedAmount, uint256 limit);
    error PolicyManagerPaused();
    error GuardPaused();

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

        bytes4 selector = data.length >= 4 ? bytes4(data) : bytes4(0);

        if (!policyManager.allowlistedCounterparty(to)) {
            emit SafeTxChecked(msg.sender, to, value, selector, true, "counterparty_not_allowlisted");
            revert CounterpartyNotAllowlisted(to);
        }

        if (value > 0) {
            _resetDailySpendIfNeeded(msg.sender);
            uint256 dailyLimit = policyManager.walletDailyLimitWei(msg.sender);
            uint256 newTotal = safeSpentTodayWei[msg.sender] + value;
            if (dailyLimit > 0 && newTotal > dailyLimit) {
                emit SafeTxChecked(msg.sender, to, value, selector, true, "daily_limit_exceeded");
                revert DailyLimitExceeded(msg.sender, newTotal, dailyLimit);
            }
            safeSpentTodayWei[msg.sender] = newTotal;
        }

        emit SafeTxChecked(msg.sender, to, value, selector, false, "allowed");
    }

    function checkAfterExecution(bytes32, bool) external override {
        // Intentionally empty: spend is recorded pre-execution to match ExecutionGuard semantics.
        // Future: refund spend on failed txs if product requires exact accounting.
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(ITransactionGuard).interfaceId || super.supportsInterface(interfaceId);
    }

    function _resetDailySpendIfNeeded(address safe) internal {
        uint256 currentDayIndex = block.timestamp / 1 days;
        if (safeSpentDayIndex[safe] != currentDayIndex) {
            safeSpentDayIndex[safe] = currentDayIndex;
            safeSpentTodayWei[safe] = 0;
            emit SafeSpendReset(safe, currentDayIndex);
        }
    }
}
