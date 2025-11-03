import { BytesLike, ethers } from 'ethers';
import { ByteUtils } from './bytes';

const bytesLikeify = (data: BytesLike): Uint8Array => {
  return new Uint8Array(ByteUtils.arrayify(data));
};

/**
 * Calculates sha256 hash of bytes
 * @returns hash
 */
function sha256(preImage: BytesLike): string {
  // Hash and return
  return ethers.sha256(bytesLikeify(preImage)).slice(2);
}

/**
 * Calculates sha512 hash of bytes
 * @param preImage - bytesdata
 * @returns hash
 */
function sha512(preImage: BytesLike): string {
  return ethers.sha512(bytesLikeify(preImage)).slice(2);
}

/**
 * Calculates sha512 hmac
 * @returns hmac
 */
function sha512HMAC(key: BytesLike, data: BytesLike): string {
  return ethers.computeHmac('sha512', bytesLikeify(key), bytesLikeify(data)).slice(2);
}

/**
 * Calculates keccak256 hash of bytes
 * @returns hash
 */
function keccak256(preImage: BytesLike): string {
  return ethers.keccak256(bytesLikeify(preImage)).slice(2);
}

export { sha256, sha512, sha512HMAC, keccak256 };
