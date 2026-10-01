// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title TokenCalldata
 * @notice Minimal, bounds-checked decoding of standard ERC-20 calldata.
 *
 * @dev A treasury guard only ever sees `(to, value, data)`. To enforce a cap on a
 *      stablecoin such as USDG it has to read the transfer amount out of `data`. Only the
 *      four standard shapes are recognised:
 *
 *        transfer(address,uint256)            0xa9059cbb
 *        transferFrom(address,address,uint256) 0x23b872dd
 *        approve(address,uint256)             0x095ea7b3
 *        increaseAllowance(address,uint256)   0x39509351
 *
 *      Anything else on a registered token is rejected outright by the guard rather than
 *      silently allowed, so a non-standard selector cannot be used to sidestep the cap.
 *
 *      Solidity does not support slicing `bytes memory`, so the arguments are read with
 *      inline assembly. The memory layout of `bytes memory data` is:
 *
 *          [0x00 .. 0x20)  length
 *          [0x20 .. )      payload, i.e. payload byte N sits at (data + 32 + N)
 *
 *      so argument K of a 4-byte-selector call sits at (data + 32 + 4 + 32*K).
 *
 *      Addresses are ABI-encoded **right-aligned** inside their 32-byte word, so the 20
 *      address bytes are the *low* 20 bytes of the word. They are extracted with a 160-bit
 *      mask. (`shr(96, word)` would be wrong here: it keeps the high 20 bytes and silently
 *      truncates the address to a well-formed but incorrect value — the token-policy tests
 *      catch exactly that mistake.)
 *
 *      Every reader below checks the length first, so no read goes past the payload.
 */
library TokenCalldata {
    /// @dev Low-20-bytes mask used to pull a right-aligned address out of an ABI word.
    ///      Written arithmetically because a 20-byte hex literal is parsed as `address`.
    uint256 private constant ADDRESS_MASK = (1 << 160) - 1;

    bytes4 internal constant TRANSFER = 0xa9059cbb;
    bytes4 internal constant TRANSFER_FROM = 0x23b872dd;
    bytes4 internal constant APPROVE = 0x095ea7b3;
    bytes4 internal constant INCREASE_ALLOWANCE = 0x39509351;

    /// @dev transfer/transferFrom both _move_ value and are counted against the daily cap.
    function isTransfer(bytes4 selector) internal pure returns (bool) {
        return selector == TRANSFER || selector == TRANSFER_FROM;
    }

    /// @dev approve/increaseAllowance _grant authority_ and are handled separately.
    function isApproval(bytes4 selector) internal pure returns (bool) {
        return selector == APPROVE || selector == INCREASE_ALLOWANCE;
    }

    /// @dev transfer(address to, uint256 amount) — 4 + 32 + 32 bytes.
    function decodeTransfer(bytes memory data) internal pure returns (address recipient, uint256 amount) {
        require(data.length >= 68, "TokenCalldata: transfer calldata too short");
        assembly ("memory-safe") {
            recipient := and(mload(add(data, 36)), ADDRESS_MASK)
            amount := mload(add(data, 68))
        }
    }

    /// @dev transferFrom(address from, address to, uint256 amount) — 4 + 96 bytes.
    function decodeTransferFrom(
        bytes memory data
    ) internal pure returns (address from, address recipient, uint256 amount) {
        require(data.length >= 100, "TokenCalldata: transferFrom calldata too short");
        assembly ("memory-safe") {
            from := and(mload(add(data, 36)), ADDRESS_MASK)
            recipient := and(mload(add(data, 68)), ADDRESS_MASK)
            amount := mload(add(data, 100))
        }
    }

    /// @dev approve(address spender, uint256 amount) — 4 + 32 + 32 bytes.
    function decodeApproval(bytes memory data) internal pure returns (address spender, uint256 amount) {
        require(data.length >= 68, "TokenCalldata: approval calldata too short");
        assembly ("memory-safe") {
            spender := and(mload(add(data, 36)), ADDRESS_MASK)
            amount := mload(add(data, 68))
        }
    }
}
