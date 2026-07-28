// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./PolicyManager.sol";

contract ExecutionGuard is AccessControl, Pausable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    PolicyManager public immutable policyManager;

    mapping(address => uint256) public walletSpentTodayWei;
    mapping(address => uint256) public walletSpentDayIndex;

    event TransactionValidated(
        address indexed wallet,
        address indexed destination,
        uint256 amountWei,
        bytes4 methodSelector,
        bool blocked,
        string reason,
        address indexed actor
    );

    event WalletSpendReset(address indexed wallet, uint256 dayIndex);

    error CounterpartyNotAllowlisted(address destination);
    error DailyLimitExceeded(address wallet, uint256 attemptedAmount, uint256 limit);
    error ZeroAddressNotAllowed();
    error InvalidAmount();
    error PolicyManagerPaused();

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

    function validateAndRecord(
        address wallet,
        address destination,
        uint256 amountWei,
        bytes4 methodSelector
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused returns (bool allowed, string memory reason) {
        if (wallet == address(0) || destination == address(0)) revert ZeroAddressNotAllowed();
        if (amountWei == 0) revert InvalidAmount();
        if (policyManager.paused()) revert PolicyManagerPaused();

        if (!policyManager.allowlistedCounterparty(destination)) {
            emit TransactionValidated(wallet, destination, amountWei, methodSelector, true, "counterparty_not_allowlisted", msg.sender);
            revert CounterpartyNotAllowlisted(destination);
        }

        _resetDailySpendIfNeeded(wallet);

        uint256 dailyLimit = policyManager.walletDailyLimitWei(wallet);
        uint256 newTotal = walletSpentTodayWei[wallet] + amountWei;
        if (dailyLimit > 0 && newTotal > dailyLimit) {
            emit TransactionValidated(wallet, destination, amountWei, methodSelector, true, "daily_limit_exceeded", msg.sender);
            revert DailyLimitExceeded(wallet, newTotal, dailyLimit);
        }

        walletSpentTodayWei[wallet] = newTotal;
        emit TransactionValidated(wallet, destination, amountWei, methodSelector, false, "allowed", msg.sender);
        return (true, "allowed");
    }

    function _resetDailySpendIfNeeded(address wallet) internal {
        uint256 currentDayIndex = block.timestamp / 1 days;
        if (walletSpentDayIndex[wallet] != currentDayIndex) {
            walletSpentDayIndex[wallet] = currentDayIndex;
            walletSpentTodayWei[wallet] = 0;
            emit WalletSpendReset(wallet, currentDayIndex);
        }
    }
}
