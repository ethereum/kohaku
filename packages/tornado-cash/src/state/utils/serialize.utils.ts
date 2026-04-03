import {
  DeserializeDictionary,
  DeserializeWithDictionary,
  Serializable,
} from "../interfaces/utils.interface";

export const serialize = <const T>(data: T): Serializable<T> => {
  switch (typeof data) {
    case "object": {
      if (data === null) {
        return data as Serializable<T>;
      }

      if (data instanceof Array) {
        return data.map(serialize) as Serializable<T>;
      }

      return Object.entries(data).reduce((serializedObject, [key, value]) => {
        serializedObject[key as keyof typeof serializedObject] =
          serialize(value);

        return serializedObject;
      }, {} as Serializable<T>);
    }
    case "bigint":
      return ("0x" + data.toString(16)) as Serializable<T>;
    default:
      return data as Serializable<T>;
  }
};

export const deserialize = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Data extends Serializable<any>,
  const Dictionary extends DeserializeDictionary<Data> | undefined = undefined,
>(
  data: Data,
  strings?: Dictionary,
): DeserializeWithDictionary<Data, Dictionary> => {
  switch (typeof data) {
    case "object": {
      if (data === null) {
        return data as DeserializeWithDictionary<Data, Dictionary>;
      }

      if (data instanceof Array) {
        if (data.length === 2) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const stringsData = (strings as [any, any]) || [];

          return [
            deserialize(data[0], stringsData[0]),
            deserialize(data[1], stringsData[1]),
          ] as DeserializeWithDictionary<Data, Dictionary>;
        }

        return data.map((d) =>
          deserialize(d, strings),
        ) as DeserializeWithDictionary<Data, Dictionary>;
      }

      return Object.entries(data).reduce(
        (deserializedObject, [key, value]) => {
          deserializedObject[key as keyof typeof deserializedObject] =
            deserialize(
              value,
              (strings || {})[key as keyof typeof strings] as Dictionary,
            ) as DeserializeWithDictionary<
              Data,
              Dictionary
            >[keyof DeserializeWithDictionary<Data, Dictionary>];

          return deserializedObject;
        },
        {} as DeserializeWithDictionary<Data, Dictionary>,
      );
    }
    case "string":
      return (
        strings === true ? data : BigInt(data)
      ) as DeserializeWithDictionary<Data, Dictionary>;
    default:
      return data as DeserializeWithDictionary<Data, Dictionary>;
  }
};
