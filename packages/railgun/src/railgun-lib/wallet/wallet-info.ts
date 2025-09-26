const MAX_LENGTH = 16;
const WALLET_SOURCE_CHARSET = ' 0123456789abcdefghijklmnopqrstuvwxyz';

export class WalletInfo {
  static walletSource: string;

  static setWalletSource(walletSource: string) {
    const lowercase = walletSource.toLowerCase();
    this.validateWalletSource(lowercase);
    WalletInfo.walletSource = lowercase;
  }

  private static validateWalletSource(walletSource: string) {
    if (walletSource.length > MAX_LENGTH) {
      throw new Error(`Wallet source must be less than ${MAX_LENGTH} characters.`);
    }
    if (!walletSource.length) {
      throw new Error(`Please add a valid wallet source.`);
    }
    this.encodeWalletSource(walletSource);
  }

  static getEncodedWalletSource(walletSource: string): string {
    if (!walletSource) {
      return '';
    }
    return this.encodeWalletSource(walletSource.toLowerCase());
  }

  /**
   * Encodes wallet source string into base 37 hex string.
   */
  private static encodeWalletSource(walletSource: string): string {
    // Initialize output in base10
    let outputNumber = 0n;

    // Calculate number system base
    const base = BigInt(WALLET_SOURCE_CHARSET.length);

    // Loop through each char from least significant to most
    for (let i = 0; i < walletSource.length; i += 1) {
      // Get decimal value of char
      const charIndex = WALLET_SOURCE_CHARSET.indexOf(walletSource[i]);

      // Throw
      if (charIndex === -1)
        throw new Error(`Invalid character for wallet source: ${walletSource[i]}`);

      // Calculate positional multiplier for char
      const positional = base ** BigInt(walletSource.length - i - 1);

      // Add char value to decimal
      outputNumber += BigInt(charIndex) * positional;
    }

    // Convert base 10 to hex
    const outputHex = outputNumber.toString(16);

    // Return even padded hex string
    return outputHex.length % 2 ? outputHex : `0${outputHex}`;
  }

  static decodeWalletSource(bytes: string): string {
    // Initialize output string
    let output = '';

    // Convert input to number
    let inputNumber = BigInt(`0x${bytes}`);

    // Calculate number system base
    const base = BigInt(WALLET_SOURCE_CHARSET.length);

    // Loop through input number it is the last positional
    while (inputNumber > 0) {
      // Calculate last positional value
      const remainder = inputNumber % base;

      // Add last positional value to start of string
      output = `${WALLET_SOURCE_CHARSET[Number(remainder)]}${output}`;

      // Subtract last positional value and shift right 1 position
      inputNumber = (inputNumber - remainder) / base;
    }

    return output;
  }
}
