/**
 * Minimal stand-ins for the n8n execution contexts, so the system tests can
 * drive real node classes (`node.execute()` / `node.trigger()`) against a real
 * rosbridge instead of poking the service layer directly.
 *
 * Deliberately small: the nodes only need parameter access, credentials,
 * continue-on-fail signalling and - for the image node - prepareBinaryData.
 */

import type {
    IBinaryData,
    IExecuteFunctions,
    ILoadOptionsFunctions,
    INodeExecutionData,
    ITriggerFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { RosBridgeCredentials } from '../../nodes/shared/services/RosBridgeService';

export type NodeParameters = Record<string, unknown>;

interface GetNodeParameterOptions {
    extractValue?: boolean;
    rawExpressions?: boolean;
}

/**
 * Collects each property's `default` from a node description, so parameters a
 * test does not set behave the way they would in the editor instead of blowing
 * up. Top-level properties only - that is all these nodes read directly.
 */
function describedDefaults(node?: { description?: { properties?: unknown[] } }): NodeParameters {
    const defaults: NodeParameters = {};
    for (const property of (node?.description?.properties ?? []) as Array<{
        name?: string;
        default?: unknown;
    }>) {
        if (property?.name !== undefined && property.default !== undefined) {
            defaults[property.name] = property.default;
        }
    }
    return defaults;
}

/**
 * Mirrors n8n's `extractValue` option: a resourceLocator parameter is handed to
 * the node as `{ mode, value }` unless the node asks for the value itself.
 */
function applyOptions(value: unknown, options?: GetNodeParameterOptions): unknown {
    if (!options?.extractValue) {
        return value;
    }
    if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
        return (value as { value: unknown }).value;
    }
    return value;
}

export const ROSBRIDGE_CREDENTIALS: RosBridgeCredentials = {
    protocol: 'ws',
    host: process.env.ROSBRIDGE_HOST ?? '127.0.0.1',
    port: Number(process.env.ROSBRIDGE_PORT ?? 9090),
    connectTimeoutMs: 15000,
};

const fakeNode = {
    id: 'system-test',
    name: 'System Test Node',
    type: 'systemTest',
    typeVersion: 1,
    position: [0, 0] as [number, number],
    parameters: {},
};

function resolveParameter(
    params: NodeParameters,
    defaults: NodeParameters,
    name: string,
    fallback?: unknown,
): unknown {
    if (name in params) {
        return params[name];
    }
    if (fallback !== undefined) {
        return fallback;
    }
    if (name in defaults) {
        return defaults[name];
    }
    throw new Error(
        `System test harness: node asked for parameter "${name}", which the test did not set and the node description has no default for`,
    );
}

export function createExecuteFunctions(
    node: { description?: { properties?: unknown[] } },
    params: NodeParameters,
    inputItems: INodeExecutionData[] = [{ json: {} }],
): IExecuteFunctions {
    const defaults = describedDefaults(node);
    return {
        getInputData: () => inputItems,
        getCredentials: async () => ROSBRIDGE_CREDENTIALS as unknown as Record<string, unknown>,
        getNodeParameter: (
            name: string,
            _itemIndex?: number,
            fallback?: unknown,
            options?: GetNodeParameterOptions,
        ) => applyOptions(resolveParameter(params, defaults, name, fallback), options),
        continueOnFail: () => false,
        isToolExecution: () => false,
        getNodeOutputs: () => [{ type: NodeConnectionTypes.Main }],
        getNode: () => fakeNode,
        helpers: {
            prepareBinaryData: async (
                data: Buffer,
                fileName?: string,
                mimeType?: string,
            ): Promise<IBinaryData> => ({
                data: data.toString('base64'),
                mimeType: mimeType ?? 'application/octet-stream',
                fileName,
                fileSize: `${data.length}`,
            }),
        },
    } as unknown as IExecuteFunctions;
}

export function createLoadOptionsFunctions(params: NodeParameters = {}): ILoadOptionsFunctions {
    return {
        getCredentials: async () => ROSBRIDGE_CREDENTIALS as unknown as Record<string, unknown>,
        getNodeParameter: (
            name: string,
            _itemIndex?: number,
            fallback?: unknown,
            options?: GetNodeParameterOptions,
        ) => applyOptions(resolveParameter(params, {}, name, fallback), options),
        getNode: () => fakeNode,
    } as unknown as ILoadOptionsFunctions;
}

export interface TriggerHarness {
    functions: ITriggerFunctions;
    /** Every item the trigger has emitted so far, flattened. */
    emitted: Array<Record<string, unknown>>;
    /** Resolves once `count` items have been emitted, or rejects on timeout. */
    waitForEmit(count: number, timeoutMs: number): Promise<Array<Record<string, unknown>>>;
}

export function createTriggerFunctions(
    node: { description?: { properties?: unknown[] } },
    params: NodeParameters,
): TriggerHarness {
    const emitted: Array<Record<string, unknown>> = [];
    const listeners: Array<() => void> = [];
    const defaults = describedDefaults(node);

    const functions = {
        getCredentials: async () => ROSBRIDGE_CREDENTIALS as unknown as Record<string, unknown>,
        // Trigger contexts take (name, fallback, options) - no item index.
        getNodeParameter: (name: string, fallback?: unknown, options?: GetNodeParameterOptions) =>
            applyOptions(resolveParameter(params, defaults, name, fallback), options),
        getNode: () => fakeNode,
        emit: (data: INodeExecutionData[][]) => {
            for (const branch of data) {
                for (const item of branch) {
                    emitted.push(item.json as Record<string, unknown>);
                }
            }
            for (const listener of [...listeners]) {
                listener();
            }
        },
        emitError: (error: Error) => {
            throw error;
        },
        helpers: {},
    } as unknown as ITriggerFunctions;

    const waitForEmit = (count: number, timeoutMs: number) =>
        new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
            const check = () => {
                if (emitted.length >= count) {
                    cleanup();
                    resolve([...emitted]);
                }
            };
            const timer = setTimeout(() => {
                cleanup();
                reject(
                    new Error(
                        `Timed out after ${timeoutMs}ms waiting for ${count} emitted item(s); got ${emitted.length}`,
                    ),
                );
            }, timeoutMs);
            const cleanup = () => {
                clearTimeout(timer);
                const index = listeners.indexOf(check);
                if (index !== -1) {
                    listeners.splice(index, 1);
                }
            };
            listeners.push(check);
            check();
        });

    return { functions, emitted, waitForEmit };
}

/** Resource locator value in "manual id" mode. */
export function id(value: string) {
    return { mode: 'id', value };
}
