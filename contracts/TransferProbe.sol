// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBalanceOf {
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Read-only transfer probe for ERC-20 tokens.
/// @dev Never deployed. Its runtime code is placed at an existing holder's address through an
///      eth_call state override, so `address(this)` holds real tokens. It transfers `amount` to `to`
///      and reports both balance changes, which exposes fees, burns, reflections and blocked transfers
///      without sending a transaction. Rebuild with `node scripts/build-probe.mjs`.
contract TransferProbe {
    function probe(address token, address to, uint256 amount)
        external
        returns (
            bool callSucceeded,
            bool returnedTrue,
            uint256 senderBefore,
            uint256 senderAfter,
            uint256 recipientBefore,
            uint256 recipientAfter,
            bytes memory revertData
        )
    {
        senderBefore = IBalanceOf(token).balanceOf(address(this));
        recipientBefore = IBalanceOf(token).balanceOf(to);
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        callSucceeded = ok;
        if (ok) {
            returnedTrue = ret.length == 0 || (ret.length >= 32 && abi.decode(ret, (bool)));
        } else {
            revertData = ret;
        }
        senderAfter = IBalanceOf(token).balanceOf(address(this));
        recipientAfter = IBalanceOf(token).balanceOf(to);
    }
}
