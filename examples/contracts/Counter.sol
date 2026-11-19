// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The Counter from the Zenith testnet quickstart, used by the deploy-and-verify walkthrough.
contract Counter {
    uint256 public number;

    event NumberChanged(uint256 newNumber);

    function setNumber(uint256 newNumber) external {
        number = newNumber;
        emit NumberChanged(newNumber);
    }

    function increment() external {
        number += 1;
        emit NumberChanged(number);
    }
}
