class VarInt {
  constructor(value, offset = 0) {
    if (typeof value === 'number' || typeof value === 'bigint') {
      this.value = BigInt(value);
      this.originallyEncodedSize = this.getSizeInBytes();
    } else if (Buffer.isBuffer(value)) {
      this.value = this.decode(value, offset);
      this.originallyEncodedSize = this.getSizeInBytes();
    } else {
      throw new Error('Invalid input: value should be a number or buffer');
    }
  }

  getOriginalSizeInBytes() {
    return this.originallyEncodedSize;
  }

  getSizeInBytes() {
    return VarInt.sizeOf(this.value);
  }

  static sizeOf(value) {
    if (value < 0) return 9;
    if (value < 253) return 1;
    if (value <= 0xFFFF) return 3;
    if (value <= 0xFFFFFFFF) return 5;
    return 9;
  }

  encode() {
    let bytes;
    switch (this.getSizeInBytes()) {
      case 1:
        return Buffer.from([Number(this.value)]);
      case 3:
        return Buffer.from([253, Number(this.value & 0xFF), Number((this.value >> 8) & 0xFF)]);
      case 5:
        bytes = Buffer.alloc(5);
        bytes[0] = 254;
        bytes.writeUInt32LE(Number(this.value), 1);
        return bytes;
      case 9:
        bytes = Buffer.alloc(9);
        bytes[0] = 255;
        bytes.writeBigUInt64LE(this.value, 1);
        return bytes;
      default:
        throw new Error('Invalid size for encoding');
    }
  }

  decode(buffer, offset = 0) {
    const first = buffer[offset];
    if (first < 253) {
      return BigInt(first);
    } else if (first === 253) {
      return BigInt(buffer.readUInt16LE(offset + 1));
    } else if (first === 254) {
      return BigInt(buffer.readUInt32LE(offset + 1));
    } else {
      return buffer.readBigUInt64LE(offset + 1);
    }
  }
}

const decodeOutpointValues = (encodedUtxoOutpointValues) => {
  let offset = 0;
  let idx = 0;
  const outpointValues = [];
  while (encodedUtxoOutpointValues.length > offset) {
    let utxoOutpointValue = new VarInt(encodedUtxoOutpointValues, offset);
    outpointValues.push(utxoOutpointValue.value);
    offset += utxoOutpointValue.getSizeInBytes();
    idx++;
  }
  return outpointValues;
}

const encodeOutpointValuesAsMap = (utxos) => {
  return utxos.reduce((map, utxo) => {
    map[utxo.valueInSatoshis] = Buffer.from(new VarInt(utxo.valueInSatoshis).encode()).toString("hex");
    return map;
  }, {});
}

module.exports = { VarInt, decodeOutpointValues, encodeOutpointValuesAsMap };
