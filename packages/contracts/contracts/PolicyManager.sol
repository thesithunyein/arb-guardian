// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract PolicyManager is AccessControl, Pausable {
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");
    error ZeroAddressNotAllowed();

    mapping(address => bool) public allowlistedCounterparty;
    mapping(address => uint256) public walletDailyLimitWei;

    event CounterpartyAllowlistUpdated(address indexed counterparty, bool allowed, address indexed actor);
    event WalletDailyLimitUpdated(address indexed wallet, uint256 limitWei, address indexed actor);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddressNotAllowed();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POLICY_ADMIN_ROLE, admin);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setCounterparty(address counterparty, bool allowed) external onlyRole(POLICY_ADMIN_ROLE) whenNotPaused {
        if (counterparty == address(0)) revert ZeroAddressNotAllowed();
        allowlistedCounterparty[counterparty] = allowed;
        emit CounterpartyAllowlistUpdated(counterparty, allowed, msg.sender);
    }

    function setWalletDailyLimit(address wallet, uint256 limitWei) external onlyRole(POLICY_ADMIN_ROLE) whenNotPaused {
        if (wallet == address(0)) revert ZeroAddressNotAllowed();
        walletDailyLimitWei[wallet] = limitWei;
        emit WalletDailyLimitUpdated(wallet, limitWei, msg.sender);
    }
}
