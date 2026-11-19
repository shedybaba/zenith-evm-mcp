// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Minimal tokens that only ever exist inside eth_call simulations in the tests.
// `balanceOf` is the first storage variable, so a holder's balance lives at keccak256(holder, 0).

contract PlainToken {
    mapping(address => uint256) public balanceOf;

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract FeeOnTransferToken {
    mapping(address => uint256) public balanceOf;

    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 fee = amount / 20;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount - fee;
        return true;
    }
}
