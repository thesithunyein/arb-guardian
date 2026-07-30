// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./interfaces/Enum.sol";
import "./interfaces/ITransactionGuard.sol";

/**
 * @title TreasurySafeShell
 * @notice Minimal 1-of-1 Safe-compatible treasury wallet for demo/enrollment on Arbitrum.
 *         Implements the GuardManager surface (setGuard/getGuard) and calls
 *         ITransactionGuard.checkTransaction before execution — same integration path
 *         as Gnosis Safe treasuries using SafeTreasuryGuard.
 */
contract TreasurySafeShell {
    address public owner;
    address public guard;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ChangedGuard(address indexed guard);
    event Executed(address indexed to, uint256 value, bool success);

    error NotOwner();
    error ZeroAddress();
    error ExecFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    receive() external payable {}

    function setGuard(address guard_) external onlyOwner {
        guard = guard_;
        emit ChangedGuard(guard_);
    }

    function getGuard() external view returns (address) {
        return guard;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @dev Mirrors Safe execTransaction guard hook semantics for Call operations.
     */
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation
    ) external onlyOwner returns (bool success) {
        address currentGuard = guard;
        if (currentGuard != address(0)) {
            ITransactionGuard(currentGuard).checkTransaction(
                to,
                value,
                data,
                operation,
                0,
                0,
                0,
                address(0),
                payable(address(0)),
                "",
                msg.sender
            );
        }

        if (operation == Enum.Operation.DelegateCall) {
            // solhint-disable-next-line avoid-low-level-calls
            (success, ) = to.delegatecall(data);
        } else {
            // solhint-disable-next-line avoid-low-level-calls
            (success, ) = to.call{value: value}(data);
        }

        if (currentGuard != address(0)) {
            ITransactionGuard(currentGuard).checkAfterExecution(bytes32(0), success);
        }

        emit Executed(to, value, success);
        if (!success) revert ExecFailed();
    }
}
