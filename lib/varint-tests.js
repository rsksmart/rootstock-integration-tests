const { expect } = require('chai');
const { VarInt, Utils } = require('./varint');

describe('VarInt Tests', function() {

  it('testBytes', function() {
    let a = new VarInt(10);
    expect(a.getSizeInBytes()).to.equal(1);
    expect(a.encode().length).to.equal(1);
    expect(new VarInt(a.encode(), 0).value).to.equal(10n);
  });

  it('testShorts', function() {
    let a = new VarInt(64000);
    expect(a.getSizeInBytes()).to.equal(3);
    expect(a.encode().length).to.equal(3);
    expect(new VarInt(a.encode(), 0).value).to.equal(64000n);
  });

  it('testShortFFFF', function() {
    let a = new VarInt(0xFFFF);
    expect(a.getSizeInBytes()).to.equal(3);
    expect(a.encode().length).to.equal(3);
    expect(new VarInt(a.encode(), 0).value).to.equal(0xFFFFn);
  });

  it('testSizeOfNegativeInt', function() {
    expect(VarInt.sizeOf(-1n)).to.equal(new VarInt(-1n).encode().length);
  });

  it('testMaxInt', function() {
    let varInt = new VarInt(BigInt(Number.MAX_SAFE_INTEGER));
    console.log(Buffer.from(varInt.encode()).toString('hex'));
  });

  it('testDeserializeListOfValuesInHex', function() {
    let expectedValues = [14435729n, 255n, 187n, 13337n];
    let values = Buffer.from('FE9145DC00FDFF00BBFD1934', 'hex');
    let offset = 0;
    let idx = 0;
    while (values.length > offset) {
      let varIntValue = new VarInt(values, offset);
      offset += varIntValue.getSizeInBytes();
      expect(varIntValue.value).to.equal(expectedValues[idx]);
      idx++;
      console.log(new Intl.NumberFormat().format(varIntValue.value));
    }
  });

  it('testSerializeListOfValuesInHex', function() {
    // FF0040075AF0750700
    const maxBitcoin = 2100000000000000n;
    let values = [maxBitcoin, 14435729n, 255n, 187n, 13337n];
    let stream = [];
    values.forEach(value => {
      let varIntValue = new VarInt(value);
      console.log(Buffer.from(varIntValue.encode()).toString('hex'));
      stream = stream.concat(Array.from(varIntValue.encode()));
    });

    let expectedResult = Buffer.from('FF0040075AF0750700FE9145DC00FDFF00BBFD1934', 'hex');
    expect(Buffer.from(stream)).to.deep.equal(expectedResult);
  });

});
