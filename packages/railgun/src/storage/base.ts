export type StorageLayer = {
    get: () => Promise<object | undefined>;
    set: (data: object) => Promise<void>;
};

export type StorageParser<O extends object, C extends object> = {
    parse: (cached: C) => Promise<O>;
    serialize: (data: O) => Promise<C>;
};

export type Storage<O extends object> = {
    load: () => Promise<O>;
    save: (data: O) => Promise<void>;
};

export const createBaseStorage = <O extends object, C extends object>({ get: read, set: write }: StorageLayer, { parse, serialize}: StorageParser<O, C>): Storage<O> => {
    const load = async () => {
        console.log('loading base storage');
        const raw = await read() as C;

        return await parse(raw);
    };

    const save = async (data: O) => {
        console.log('saving base storage')
        const raw = await serialize(data) as C;

        await write(raw);
    };

    return {
        load,
        save,
    };
};
