import type { Request } from 'express';
import { applyResponseSerializer, ResponseSerializer } from '@lib/http/serialization/serializer';

/**
 * CRUD serialize pre-pass: applies user serializers to RAW Prisma data BEFORE JSON:API
 * transformation.
 *
 * Deterministic by design — relation positions are addressed by `?include=` path keys, never
 * by data-shape inference or schemaAnalyzer (which is null-prone in production). Operating on
 * raw data (before attributes/relationships/included split) makes both includeMerge modes
 * behave identically. The identity key is always preserved so JSON:API resources keep a valid id.
 */

/** JSON:API identity key for included relation resources (the transformer reads item.id). */
const INCLUDED_ID_KEY = 'id';

/**
 * Apply `sz` to a node (single object or array of objects) via the shared ResponseSerializer
 * engine, then restore `idKey` if the serializer dropped it. A JSON:API resource MUST have an
 * id, so pick/omit/function output can never strip identity.
 */
async function applyWithIdPreserved(
    node: unknown,
    sz: ResponseSerializer<any>,
    req: Request,
    idKey: string,
): Promise<unknown> {
    const filtered = await applyResponseSerializer(node, sz, req);
    const restore = (orig: any, filt: any) => {
        if (
            filt &&
            typeof filt === 'object' &&
            !Array.isArray(filt) &&
            orig &&
            typeof orig === 'object' &&
            idKey in orig &&
            !(idKey in filt)
        ) {
            const target = Object.isFrozen(filt) ? { ...filt } : filt;
            target[idKey] = orig[idKey];
            return target;
        }
        return filt;
    };
    if (Array.isArray(node) && Array.isArray(filtered)) {
        return filtered.map((f, i) => restore((node as any[])[i], f));
    }
    return restore(node, filtered);
}

/**
 * Walk `record` along `segments` and apply `sz` to the leaf relation node(s). Intermediate
 * nodes may be arrays (e.g. posts[].author) — recurse per element. A missing node is a no-op
 * (the relation was not loaded for this request). Container references are mutated in place
 * (request-local Prisma data); leaf objects are replaced with filtered copies.
 */
async function applyAtPath(
    record: any,
    segments: string[],
    sz: ResponseSerializer<any>,
    req: Request,
): Promise<any> {
    if (record === null || record === undefined || typeof record !== 'object') return record;
    const [head, ...rest] = segments;
    const child = record[head];
    if (child === null || child === undefined) return record; // relation not loaded → no-op
    if (rest.length === 0) {
        record[head] = await applyWithIdPreserved(child, sz, req, INCLUDED_ID_KEY);
        return record;
    }
    if (Array.isArray(child)) {
        for (let i = 0; i < child.length; i++) {
            child[i] = await applyAtPath(child[i], rest, sz, req);
        }
    } else {
        record[head] = await applyAtPath(child, rest, sz, req);
    }
    return record;
}

/**
 * Apply user CRUD serializers to raw data. No-op (returns the input unchanged) when neither
 * serializer is configured.
 *
 * @param data            single record or array of records (Prisma result)
 * @param rootSerializer  applied to each top-level record (keys = primary model fields)
 * @param includeSerializers  map of `?include=` path → serializer for that relation node
 * @param req             passed to function-form serializers
 * @param opts.primaryKey identity field of the root model
 *
 * @remarks Mutates relation nodes in-place on the input `data` (request-local Prisma result).
 *          Callers must use the returned value and not reuse the original `data` reference afterward.
 */
export async function applyCrudSerializers<D>(
    data: D,
    rootSerializer: ResponseSerializer<any> | undefined,
    includeSerializers: Record<string, ResponseSerializer<any>> | undefined,
    req: Request,
    opts: { primaryKey: string },
): Promise<D> {
    const includeEntries = includeSerializers ? Object.entries(includeSerializers) : [];
    if (!rootSerializer && includeEntries.length === 0) {
        return data; // nothing configured → passthrough (same reference)
    }
    // Parents before children: a parent pick that drops a relation makes the child path a no-op.
    includeEntries.sort((a, b) => a[0].split('.').length - b[0].split('.').length);

    const records: any[] = Array.isArray(data) ? data : [data];
    const out: any[] = [];
    for (const record of records) {
        if (record === null || record === undefined || typeof record !== 'object') {
            out.push(record);
            continue;
        }
        let working = record;
        // 1) relations first, so a root pick/omit shallow-copy carries already-filtered nested refs
        for (const [path, sz] of includeEntries) {
            working = await applyAtPath(working, path.split('.'), sz, req);
        }
        // 2) root
        if (rootSerializer) {
            working = await applyWithIdPreserved(working, rootSerializer, req, opts.primaryKey);
        }
        out.push(working);
    }
    return (Array.isArray(data) ? out : out[0]) as D;
}
