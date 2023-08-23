pragma solidity ^0.4.16;

contract ContractCallsTester {
    address contractAddress;

    function ContractCallsTester(address _contractAddress) {
      contractAddress = _contractAddress;
    }

    function areYouAlive() constant returns (string) {
      return "yes i am";
    }

    function getAddress() constant returns (address) {
      return contractAddress;
    }

    function doCall(bytes abi) returns (bool) {
      return contractAddress.call(abi);
    }
}
