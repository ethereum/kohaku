import { keccak256 } from 'ethereum-cryptography/keccak';
import { ShieldNoteERC20 } from '../../railgun/lib/note/erc20/shield-note-erc20';
import { ByteUtils } from '../../railgun/lib/utils/bytes';
import type { RailgunSigner } from '../../provider/provider';

export const deriveShieldPrivateKey = async (signer: RailgunSigner): Promise<Uint8Array> => {
  const message = ShieldNoteERC20.getShieldPrivateKeySignatureMessage();
  const signature = await signer.signMessage(message);
  const signatureBytes = ByteUtils.hexStringToBytes(signature);

  return keccak256(signatureBytes);
};
