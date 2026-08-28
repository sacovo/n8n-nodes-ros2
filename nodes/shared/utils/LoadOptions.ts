/**
 * Shared building blocks for the editor-facing `methods` of the ROS nodes:
 * `listSearch` dropdowns and `resourceMapping` field lists.
 *
 * Every one of these runs while the user edits the workflow, against a live
 * rosbridge. They share three rules, which is why they live here instead of
 * being written out per node:
 *   - they resolve the `rosBridgeApi` credential and connect through the
 *     pooled {@link RosBridgeService},
 *   - they never throw: a failure means the editor shows an empty list, not a
 *     broken node panel,
 *   - the value the user picked in another field arrives as a resourceLocator,
 *     which has to be unwrapped before it can be used as a name.
 */

import type { ILoadOptionsFunctions, INodeListSearchResult, ResourceMapperFields } from 'n8n-workflow';
import type { Ros, rosapi } from 'roslib';

import { RosApiService } from '../services/RosApiService';
import { RosBridgeService, type RosBridgeCredentials } from '../services/RosBridgeService';
import { RosN8nFormatter } from './RosN8nFormatter';
import { filterByScope, parseTopicScope } from './TopicScope';

type ListSearchItems = INodeListSearchResult['results'];

/** A `listSearch` method as n8n calls it. */
type ListSearchMethod = (this: ILoadOptionsFunctions, filter?: string) => Promise<INodeListSearchResult>;

/** A `resourceMapping` method as n8n calls it. */
type ResourceMappingMethod = (this: ILoadOptionsFunctions) => Promise<ResourceMapperFields>;

/**
 * Reads a resourceLocator parameter and returns its plain string value, or an
 * empty string when it is unset. `extractValue` already collapses the locator
 * for the `list` mode, but a manually typed value still arrives as the raw
 * `{ mode, value }` object, so both shapes have to be handled.
 */
export function getLocatorValue(ctx: ILoadOptionsFunctions, parameterName: string): string {
    const locator = ctx.getNodeParameter(parameterName, '', { extractValue: true }) as
        | { value?: string }
        | string
        | undefined;
    const value = typeof locator === 'string' ? locator : locator?.value;
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Connects to rosbridge and runs `work` against it. Any failure - unusable
 * credential, unreachable rosbridge, rosapi not answering - yields `fallback`,
 * because a load-options method that throws leaves the node panel in an error
 * state instead of just showing nothing to pick.
 */
export async function withRosbridge<T>(
    ctx: ILoadOptionsFunctions,
    fallback: T,
    work: (ros: Ros) => Promise<T>,
): Promise<T> {
    try {
        const credentials = (await ctx.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
        return await work(await RosBridgeService.connect(credentials));
    } catch {
        return fallback;
    }
}

/**
 * Builds a dropdown that lists names from the ROS graph. `fetch` produces the
 * names, `format` turns them into the entries n8n renders (and applies the
 * search box's `filter`).
 */
export function listSearch(
    fetch: (ros: Ros, ctx: ILoadOptionsFunctions) => Promise<string[]>,
    format: (names: string[], filter?: string) => ListSearchItems,
): ListSearchMethod {
    return async function (this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
        return withRosbridge(this, { results: [] }, async (ros) => ({
            results: format(await fetch(ros, this), filter),
        }));
    };
}

/**
 * Builds the topic dropdown. When `scopeOptionsParameter` names an options
 * collection carrying `allowedNamespaces`, topics outside those namespaces are
 * hidden. That is convenience only - the enforced gate lives in execute().
 */
export function topicListSearch(options: { scopeOptionsParameter?: string } = {}): ListSearchMethod {
    return listSearch(async (ros, ctx) => {
        const { topics } = await RosApiService.getTopics(ros);
        const names = topics ?? [];
        if (!options.scopeOptionsParameter) {
            return names;
        }
        return filterByScope(names, readTopicScope(ctx, options.scopeOptionsParameter));
    }, RosN8nFormatter.formatTopicListForN8n);
}

/**
 * Builds the read-only "Detected: <type>" dropdown that mirrors back the type
 * of whatever the user selected in `sourceParameter`. Returns nothing while
 * that parameter is empty, or when the type does not match the search filter.
 */
export function detectedTypeSearch(
    sourceParameter: string,
    resolve: (ros: Ros, source: string) => Promise<string>,
): ListSearchMethod {
    return async function (this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
        const source = getLocatorValue(this, sourceParameter);
        if (!source) {
            return { results: [] };
        }
        return withRosbridge(this, { results: [] }, async (ros) => {
            const type = await resolve(ros, source);
            if (!type || (filter && !type.toLowerCase().includes(filter.toLowerCase()))) {
                return { results: [] };
            }
            return { results: [{ name: `Detected: ${type}`, value: type }] };
        });
    };
}

/**
 * Builds the resource-mapper field list for a ROS type. The type normally
 * comes from `typeParameter`; while that is still empty it is resolved from
 * `source` instead, so the mapper fills itself in as soon as the user picks a
 * topic / service / action server.
 */
export function typeFieldsMapper(config: {
    typeParameter: string;
    source?: {
        parameter: string;
        resolve: (ros: Ros, source: string) => Promise<string>;
    };
    /** Last chance to adjust the resolved type, e.g. the `_Request` suffix a service needs. */
    normalizeType?: (type: string) => string;
    fetchTypeDefs: (ros: Ros, type: string) => Promise<rosapi.TypeDef[]>;
}): ResourceMappingMethod {
    return async function (this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        return withRosbridge(this, { fields: [] }, async (ros) => {
            let type = getLocatorValue(this, config.typeParameter);

            if (!type && config.source) {
                const source = getLocatorValue(this, config.source.parameter);
                if (source) {
                    type = await config.source.resolve(ros, source);
                }
            }

            if (!type) {
                return { fields: [] };
            }

            const typeDefs = await config.fetchTypeDefs(ros, config.normalizeType ? config.normalizeType(type) : type);
            return RosN8nFormatter.getRosMessageStructure(typeDefs);
        });
    };
}

/**
 * Reads the namespace scope out of an options collection. The parameter is not
 * always resolvable in a load-options context; when it is not, no scope is
 * applied and everything is offered.
 */
function readTopicScope(ctx: ILoadOptionsFunctions, parameterName: string): string[] {
    try {
        const options = (ctx.getNodeParameter(parameterName, {}) || {}) as { allowedNamespaces?: string };
        return parseTopicScope(options.allowedNamespaces);
    } catch {
        return [];
    }
}
