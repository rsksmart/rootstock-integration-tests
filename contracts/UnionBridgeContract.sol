// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface BridgeInterface {
    function requestUnionBridgeRbtc(uint256 amountRequested) external returns (int256);

    function releaseUnionBridgeRbtc() external payable returns (int256);
}

contract UnionBridgeContract {
    BridgeInterface public bridge = BridgeInterface(0x0000000000000000000000000000000001000006);

    function requestUnionBridgeRbtc(uint256 amountToRequest) external returns (int256) {
        return bridge.requestUnionBridgeRbtc(amountToRequest);
    }

    function releaseUnionBridgeRbtc(uint256 amountToRelease) public payable returns (int256) {
        return bridge.releaseUnionBridgeRbtc{value: amountToRelease}();
    }

    receive() external payable { }

    fallback() external payable { }
}
