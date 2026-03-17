export type Serializable<T> = T extends [infer Key, infer Value]
  ? [Serializable<Key>, Serializable<Value>]
  : T extends Array<infer U>
    ? Serializable<U>[]
    : T extends bigint
      ? string
      : T extends object
        ? {
            [key in keyof T]: Serializable<T[key]>;
          }
        : T;

export type DeserializeDictionary<T> = T extends [infer Key, infer Value]
  ? [DeserializeDictionary<Key>, DeserializeDictionary<Value>]
  : T extends Array<infer U>
    ? DeserializeDictionary<U>
    : T extends object
      ? {
          [key in keyof Partial<T> as T[key] extends bigint & {}
            ? never
            : T[key] extends string | object
              ? key
              : never]: T[key] extends object
            ? DeserializeDictionary<T[key]>
            : T[key] extends string
              ? true | undefined
              : never;
        }
      : T extends string
        ? true | undefined
        : never;

export type Deserialize<
  T,
  StringIs extends string | bigint = string | bigint,
> = T extends [infer Key, infer Value]
  ? [Deserialize<Key>, Deserialize<Value>]
  : T extends Array<infer U>
    ? Deserialize<U>[]
    : T extends string
      ? StringIs
      : T extends bigint & {}
        ? bigint
        : T extends object
          ? {
              [key in keyof T]: Deserialize<T[key], StringIs>;
            }
          : T;

type Stringize<T> = T extends undefined
  ? bigint
  : T extends true
    ? string
    : never;

export type DeserializeWithDictionary<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Des extends Serializable<any>,
  Dict extends DeserializeDictionary<Des> | undefined,
> = Des extends [Serializable<infer Key>, Serializable<infer Value>]
  ? Dict extends [DeserializeDictionary<Key>, DeserializeDictionary<Value>]
    ? [
        DeserializeWithDictionary<Key, Dict[0]>,
        DeserializeWithDictionary<Value, Dict[1]>,
      ]
    : [
        DeserializeWithDictionary<Key, undefined>,
        DeserializeWithDictionary<Value, undefined>,
      ]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  : Des extends Serializable<any>[]
    ? DeserializeWithDictionary<Des[number], Dict>[]
    : Des extends string ? Stringize<Dict> : {
        [key in keyof Des]: key extends keyof Dict
          ? Des[key] extends string
            ? Stringize<Dict[key]>
            : Dict[key] extends DeserializeDictionary<Des[key]>
              ? DeserializeWithDictionary<Des[key], Dict[key]>
              : Des[key]
          : Deserialize<Des[key], bigint>;
      };
