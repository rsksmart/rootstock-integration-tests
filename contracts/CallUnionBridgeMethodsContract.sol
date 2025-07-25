// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface BridgeInterface {
    function requestUnionRBTC(uint256 amountInWeis) external returns (int256);
    function releaseUnionRBTC() external payable returns (int256);
}

contract CallUnionBridgeMethodsContract {
    BridgeInterface public bridgeContract = BridgeInterface(0x0000000000000000000000000000000001000006);

    function requestUnionRBTC(uint256 amountInWeis) external returns (int256) {
        return unionBridgeContract.requestUnionRBTC(amountInWeis);
    }

    function releaseUnionRBTC() external payable returns (int256) {
        return unionBridgeContract.releaseUnionRBTC{value: msg.value}();
    }
}
