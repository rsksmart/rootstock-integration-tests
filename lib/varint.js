class VarInt {
  constructor(valueOrBuf, offset = 0) {
    if (typeof valueOrBuf === 'number' || typeof valueOrBuf === 'bigint') {
      this.value = BigInt.asUintN(64, BigInt(valueOrBuf)); // Ensure value is treated as unsigned 64-bit integer
      this.originallyEncodedSize = this.getSizeInBytes();
    } else if (valueOrBuf instanceof Uint8Array) {
      const buf = valueOrBuf;
      const first = buf[offset] & 0xFF;
      if (first < 253) {
        this.value = BigInt(first);
        this.originallyEncodedSize = 1;
      } else if (first === 253) {
        this.value = BigInt((buf[offset + 1] & 0xFF) | ((buf[offset + 2] & 0xFF) << 8));
        this.originallyEncodedSize = 3;
      } else if (first === 254) {
        this.value = Utils.readUint32(buf, offset + 1);
        this.originallyEncodedSize = 5;
      } else {
        this.value = Utils.readInt64(buf, offset + 1);
        this.originallyEncodedSize = 9;
      }
    } else {
      throw new Error('Invalid constructor argument');
    }
  }

  getOriginalSizeInBytes() {
    return this.originallyEncodedSize;
  }

  getSizeInBytes() {
    return VarInt.sizeOf(this.value);
  }

  static sizeOf(value) {
    if (value < 0) return 9; // 1 marker + 8 data bytes
    if (value < 253) return 1; // 1 data byte
    if (value <= 0xFFFFn) return 3; // 1 marker + 2 data bytes
    if (value <= 0xFFFFFFFFn) return 5; // 1 marker + 4 data bytes
    return 9; // 1 marker + 8 data bytes
  }

  encode() {
    let bytes;
    switch (VarInt.sizeOf(this.value)) {
      case 1:
        return new Uint8Array([Number(this.value)]);
      case 3:
        return new Uint8Array([253, Number(this.value) & 0xFF, (Number(this.value) >> 8) & 0xFF]);
      case 5:
        bytes = new Uint8Array(5);
        bytes[0] = 254;
        Utils.uint32ToByteArrayLE(this.value, bytes, 1);
        return bytes;
      default:
        bytes = new Uint8Array(9);
        bytes[0] = 255;
        Utils.uint64ToByteArrayLE(this.value, bytes, 1);
        return bytes;
    }
  }
}

class Utils {
  static readUint32(buf, offset) {
    return BigInt((buf[offset] & 0xFF) |
      ((buf[offset + 1] & 0xFF) << 8) |
      ((buf[offset + 2] & 0xFF) << 16) |
      ((buf[offset + 3] & 0xFF) << 24) >>> 0);
  }

  static readInt64(buf, offset) {
    let low = Utils.readUint32(buf, offset);
    let high = Utils.readUint32(buf, offset + 4);
    return (high << 32n) + low;
  }

  static uint32ToByteArrayLE(value, buf, offset) {
    value = BigInt(value);
    buf[offset] = Number(value & 0xFFn);
    buf[offset + 1] = Number((value >> 8n) & 0xFFn);
    buf[offset + 2] = Number((value >> 16n) & 0xFFn);
    buf[offset + 3] = Number((value >> 24n) & 0xFFn);
  }

  static uint64ToByteArrayLE(value, buf, offset) {
    value = BigInt(value);
    Utils.uint32ToByteArrayLE(value & 0xFFFFFFFFn, buf, offset);
    Utils.uint32ToByteArrayLE(value >> 32n, buf, offset + 4);
  }
}

module.exports = { VarInt, Utils };
