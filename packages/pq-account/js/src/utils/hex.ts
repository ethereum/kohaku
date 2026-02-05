export const hexToU8 = (hex: string, expectedBytes?: number): Uint8Array => {
  if (hex.startsWith("0x")) hex = hex.slice(2);

  if (hex.length === 0 || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }

  const bytes = Uint8Array.from(
    hex.match(/.{2}/g)!.map((b) => parseInt(b, 16))
  );

  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new Error(`Expected ${expectedBytes} bytes, got ${bytes.length}`);
  }

  return bytes;
};
