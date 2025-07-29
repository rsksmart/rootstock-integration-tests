// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface BridgeInterface {
    function requestUnionBridgeRbtc(uint256 amountInWeis) external returns (int256);
    function releaseUnionBridgeRbtc() external payable returns (int256);
}

contract CallUnionBridgeMethodsContract {
    BridgeInterface public bridge = BridgeInterface(0x0000000000000000000000000000000001000006);

    function requestUnionRBTC(uint256 _amountInWeis) external returns (int256) {
        return bridge.requestUnionBridgeRbtc(_amountInWeis);
    }

    function releaseUnionRBTC() external payable returns (int256) {
        return bridge.releaseUnionBridgeRbtc{value: msg.value}();
    }

    receive() external payable {}
}
