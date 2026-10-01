// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDG
 * @notice Test-only stablecoin shaped like USDG (Paxos Global Dollar): a plain ERC-20 with
 *         **6 decimals**, which is the important property for policy testing. The guard's
 *         token lane works in the token's own base units, so a $5,000 cap is 5_000e6 here
 *         rather than 5e18 as it would be for an 18-decimal asset.
 *
 * @dev Not for production use. It exists so `tokenDailyLimit` and the calldata decoding in
 *      `TokenCalldata` are exercised against realistic 6-decimal amounts, including the
 *      18-vs-6 decimal mistake that a wei-denominated policy would have caused.
 */
contract MockUSDG is ERC20 {
    constructor() ERC20("Mock Global Dollar", "mUSDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
