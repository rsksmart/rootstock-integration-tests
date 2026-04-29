// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface BridgeInterface {
    function requestUnionBridgeRbtc(uint256 amountRequested) external returns (int256);

    function releaseUnionBridgeRbtc() external payable returns (int256);

    function setSuperEvent(bytes calldata superEvent) external;

    function clearSuperEvent() external;

    function setBaseEvent(bytes calldata baseEvent) external;

    function clearBaseEvent() external;
}

contract UnionBridgeContract {
    BridgeInterface public bridge = BridgeInterface(0x0000000000000000000000000000000001000006);

    function requestUnionBridgeRbtc(uint256 amountToRequest) external returns (int256) {
        return bridge.requestUnionBridgeRbtc(amountToRequest);
    }

    function releaseUnionBridgeRbtc(uint256 amountToRelease) public payable returns (int256) {
        return bridge.releaseUnionBridgeRbtc{value: amountToRelease}();
    }

    function setSuperEvent(bytes calldata data) external {
        bridge.setSuperEvent(data);
    }

    function clearSuperEvent() external {
        bridge.clearSuperEvent();
    }

    function setBaseEvent(bytes calldata data) external {
        bridge.setBaseEvent(data);
    }

    function clearBaseEvent() external {
        bridge.clearBaseEvent();
    }

    receive() external payable { }

    fallback() external payable { }
}
