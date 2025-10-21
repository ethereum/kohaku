/**
 * JSON.stringify does not handle bigint values out-of-the-box.
 * This handler will safely stringify bigints into decimal strings.
 */
export const stringifySafe = (obj: object) => {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString(10) : value,
  );
};
