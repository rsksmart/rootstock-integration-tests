pragma solidity ^0.8.0;

interface BridgeInterface {
    function releaseBtc() external payable;
}

contract CallReleaseBtcContract {

    BridgeInterface public bridgeContract = BridgeInterface(0x0000000000000000000000000000000001000006);

    function callBridgeReleaseBtc() external payable {
        bridgeContract.releaseBtc{value:msg.value}();
    }

}
