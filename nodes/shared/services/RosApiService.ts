/**
 * RosApiService - ROS API query operations
 * This service handles ROS system queries like getting topics, services, etc.
 */

import type { Ros, rosapi } from 'roslib';

import { RosBridgeService, RosBridgeTimeoutError } from './RosBridgeService';

export type ExpandedTypeDef = string | { [key: string]: ExpandedTypeDef | ExpandedTypeDef[] };

export interface NodeTopicDefinition {
    name: string;
    type?: string;
    definition?: ExpandedTypeDef;
    error?: string;
}

export interface NodeServiceDefinition {
    name: string;
    type?: string;
    request?: ExpandedTypeDef;
    response?: ExpandedTypeDef;
    error?: string;
}

export interface NodeActionDefinition {
    name: string;
    type?: string;
    goal?: ExpandedTypeDef;
    result?: ExpandedTypeDef;
    feedback?: ExpandedTypeDef;
    error?: string;
}

/**
 * Response of `/rosapi/get_param` and `/rosapi/set_param`. `successful` and
 * `reason` only exist on newer rosapi builds.
 */
interface RosapiParamResponse {
    value?: string;
    successful?: boolean;
    reason?: string;
}

export interface NodeDefinition {
    publishing: NodeTopicDefinition[];
    subscribing: NodeTopicDefinition[];
    services: NodeServiceDefinition[];
    actions: NodeActionDefinition[];
}

export class RosApiService {
    /**
     * Rover convention: nodes publish a latched (transient_local)
     * std_msgs/String topic next to each interface they own, documenting how
     * that specific topic/service is used.
     */
    static readonly DESCRIPTION_TOPIC_SUFFIX = '/desc';

    /**
     * Client-side deadline for every `/rosapi/*` request. rosbridge normally
     * reports a service call it cannot complete as an error, but only while
     * it is able to answer at all: `rosapi_node` spins bare, so a single
     * failing request takes every `/rosapi/*` service off the graph and the
     * response to an in-flight call never arrives. Without a deadline the
     * node would then wait forever.
     */
    static readonly REQUEST_TIMEOUT_MS = process.env.ROS_API_TIMEOUT_MS
        ? parseInt(process.env.ROS_API_TIMEOUT_MS, 10)
        : 30000;

    /**
     * Turns a roslib success/error callback pair into a promise that is
     * guaranteed to settle: whichever of the two callbacks or the deadline
     * comes first wins, later ones are ignored.
     */
    private static request<T>(
        description: string,
        call: (onSuccess: (result: T) => void, onError: (error: Error) => void) => void,
        timeoutMs = this.REQUEST_TIMEOUT_MS,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                reject(
                    new RosBridgeTimeoutError(
                        `${description} did not answer within ${timeoutMs}ms. Is rosapi still running?`,
                    ),
                );
            }, timeoutMs);

            const settle = (finish: () => void) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                finish();
            };

            try {
                call(
                    (result) => settle(() => resolve(result)),
                    (error) => settle(() => reject(error)),
                );
            } catch (error) {
                settle(() => reject(error as Error));
            }
        });
    }

    private static loadRoslib() {
        // We use eval('import(...)') to prevent tsc from transpiling this to require(),
        // as roslib 2.x is an ESM-only package and doesn't support require().
        return (0, eval)('import("roslib")') as Promise<typeof import('roslib')>;
    }

    /**
     * Reads the latched `<name>/desc` documentation topic for a topic or
     * service. Returns null when no such topic exists or nothing arrives in
     * time (undocumented interfaces must not fail the main lookup).
     */
    static async getInterfaceDescription(ros: Ros, name: string, timeoutMs = 2000): Promise<string | null> {
        const descTopic = `${name}${this.DESCRIPTION_TOPIC_SUFFIX}`;
        try {
            const { topics } = await this.getTopics(ros);
            if (!topics.includes(descTopic)) {
                return null;
            }
            const message = await RosBridgeService.waitForTopicMessage(
                ros,
                descTopic,
                'std_msgs/msg/String',
                timeoutMs,
            );
            return typeof message.data === 'string' ? message.data : null;
        } catch {
            return null;
        }
    }

    /**
     * Returns the raw message definition text (as in the .msg source,
     * including comments about units and allowed values) for a topic or
     * message type. rosapi only exposes raw definitions via
     * topics_and_raw_types, so this works only for message types currently
     * used by an active topic; returns null otherwise.
     */
    static async getTopicRawDefinition(ros: Ros, topicName?: string, messageType?: string): Promise<string | null> {
        try {
            const { topics, types, typedefs_full_text: rawDefinitions } = await this.getTopicsAndRawTypes(ros);
            let index = topicName ? topics.indexOf(topicName) : -1;
            if (index === -1 && messageType) {
                index = types.indexOf(messageType);
            }
            return index === -1 ? null : (rawDefinitions[index] ?? null);
        } catch {
            return null;
        }
    }

    static async getTopics(ros: Ros): Promise<rosapi.TopicsResponse> {
        return this.request('/rosapi/topics', (onSuccess, onError) => {
            ros.getTopics(onSuccess, (error) => onError(new Error(error)));
        });
    }

    static async getNodes(ros: Ros): Promise<string[]> {
        return this.request('/rosapi/nodes', (onSuccess, onError) => {
            ros.getNodes(onSuccess, (error) => onError(new Error(error)));
        });
    }

    static async getNodeDetails(ros: Ros, node: string): Promise<rosapi.NodeDetailsResponse> {
        return this.request('/rosapi/node_details', (onSuccess, onError) => {
            ros.getNodeDetails(node, onSuccess, (error) => onError(new Error(error)));
        });
    }

    static async getServices(ros: Ros): Promise<string[]> {
        return this.request('/rosapi/services', (onSuccess, onError) => {
            ros.getServices(onSuccess, (error) => onError(new Error(error)));
        });
    }

    static async getActionServers(ros: Ros): Promise<string[]> {
        return this.request('/rosapi/action_servers', (onSuccess, onError) => {
            ros.getActionServers(onSuccess, (error) => onError(new Error(error)));
        });
    }

    static async getTopicsForType(ros: Ros, topicType: string): Promise<string[]> {
        return this.request('/rosapi/topics_for_type', (onSuccess, onError) => {
            ros.getTopicsForType(topicType, onSuccess, (error) => onError(new Error(error)));
        });
    }

    static async getServicesForType(ros: Ros, serviceType: string): Promise<string[]> {
        return this.request('/rosapi/services_for_type', (onSuccess, onError) => {
            ros.getServicesForType(serviceType, onSuccess, (error) => onError(new Error(error)));
        });
    }

    static async getTopicType(ros: Ros, topic: string): Promise<string> {
        return this.request('/rosapi/topic_type', (onSuccess, onError) => {
            ros.getTopicType(topic, onSuccess, (error) => onError(new Error(error)));
        });
    }

    static async getServiceType(ros: Ros, service: string): Promise<string> {
        return this.request('/rosapi/service_type', (onSuccess, onError) => {
            ros.getServiceType(service, onSuccess, (error) => onError(new Error(error)));
        });
    }

    /**
     * Resolves the type of an action server. `/rosapi/action_type` answers
     * this directly and is the only reliable route: the `_action/send_goal`
     * service an action type could otherwise be derived from is a *hidden*
     * service, and rosapi's `service_type` lookup only searches non-hidden
     * services, so that derivation returns an empty type on any current
     * rosbridge. It stays as a fallback for builds without `action_type`.
     */
    static async getActionType(ros: Ros, actionServer: string): Promise<string> {
        const actionName = actionServer.endsWith('/') ? actionServer.slice(0, -1) : actionServer;

        try {
            const response = await this.callRosapi<{ action: string }, { type?: string }>(
                ros,
                'action_type',
                'ActionType',
                { action: actionName },
            );
            if (response?.type) {
                return response.type;
            }
        } catch {
            // rosapi without an `action_type` service - fall through.
        }

        try {
            const serviceType = await this.getServiceType(ros, `${actionName}/_action/send_goal`);
            // Service type is usually something like 'action_tutorials_interfaces/action/Fibonacci_SendGoal'
            // We want 'action_tutorials_interfaces/action/Fibonacci'
            if (serviceType.endsWith('_SendGoal')) {
                return serviceType.replace('_SendGoal', '');
            }
            return serviceType;
        } catch {
            return '';
        }
    }

    static async getMessageDetails(ros: Ros, message: string): Promise<rosapi.TypeDef[]> {
        return this.request('/rosapi/message_details', (onSuccess, onError) => {
            ros.getMessageDetails(message, onSuccess, (error) => onError(new Error(error)));
        });
    }

    static async getServiceRequestDetails(ros: Ros, type: string): Promise<rosapi.TypeDef[]> {
        return this.request('/rosapi/service_request_details', (onSuccess, onError) => {
            ros.getServiceRequestDetails(
                type,
                (result) => onSuccess(result.typedefs),
                (error) => onError(new Error(error)),
            );
        });
    }

    static async getServiceResponseDetails(ros: Ros, type: string): Promise<rosapi.TypeDef[]> {
        return this.request('/rosapi/service_response_details', (onSuccess, onError) => {
            ros.getServiceResponseDetails(
                type,
                (result) => onSuccess(result.typedefs),
                (error) => onError(new Error(error)),
            );
        });
    }

    static async getActionGoalDetails(ros: Ros, type: string): Promise<rosapi.TypeDef[]> {
        return this.callRosapiService(ros, 'action_goal_details', 'ActionGoalDetails', type);
    }

    static async getActionResultDetails(ros: Ros, type: string): Promise<rosapi.TypeDef[]> {
        return this.callRosapiService(ros, 'action_result_details', 'ActionResultDetails', type);
    }

    static async getActionFeedbackDetails(ros: Ros, type: string): Promise<rosapi.TypeDef[]> {
        return this.callRosapiService(ros, 'action_feedback_details', 'ActionFeedbackDetails', type);
    }

    /**
     * Calls a `/rosapi/<serviceName>` service. roslib only wraps part of the
     * rosapi surface, so anything beyond that (e.g. `action_type`) goes
     * through here.
     */
    private static async callRosapi<Request, Response>(
        ros: Ros,
        serviceName: string,
        serviceType: string,
        request: Request,
    ): Promise<Response> {
        const { Service } = await this.loadRoslib();

        return this.request<Response>(`/rosapi/${serviceName}`, (onSuccess, onError) => {
            // roslib v2 services take a plain request object directly (there is
            // no `ServiceRequest` wrapper class, unlike roslib v1).
            const client = new Service<Request, Response>({
                ros,
                name: `/rosapi/${serviceName}`,
                serviceType: `rosapi/${serviceType}`,
            });
            client.callService(request, onSuccess, (error) =>
                onError(new Error(`/rosapi/${serviceName} failed: ${error}`)),
            );
        });
    }

    private static async callRosapiService(
        ros: Ros,
        serviceName: string,
        serviceType: string,
        type: string,
    ): Promise<rosapi.TypeDef[]> {
        const result = await this.callRosapi<{ type: string }, unknown>(ros, serviceName, serviceType, { type });

        if (result && typeof result === 'object' && Array.isArray((result as { typedefs?: unknown }).typedefs)) {
            return (result as { typedefs: rosapi.TypeDef[] }).typedefs;
        }
        if (Array.isArray(result)) {
            return result as rosapi.TypeDef[];
        }
        return [];
    }

    /**
     * Expands the root type of a rosapi typedef response. Service and action
     * sub-definitions (request/response, goal/result/feedback) come back with
     * root type names derived from the generated Python classes (e.g.
     * `rcl_interfaces/GetParameters_Request` for
     * `rcl_interfaces/srv/GetParameters`), so an exact-name lookup never
     * matches the interface type the caller asked about. rosapi always
     * returns the root typedef first, so fall back to the first entry when
     * the requested name has no exact match.
     */
    static expandRootTypeDef(typeName: string, typedefs: rosapi.TypeDef[]): ExpandedTypeDef {
        if (typedefs.length > 0 && !typedefs.some((typedef) => typedef.type === typeName)) {
            return this.expandTypeDef(typedefs[0].type, typedefs);
        }
        return this.expandTypeDef(typeName, typedefs);
    }

    /**
     * Expands a ROS message definition by recursively resolving nested types.
     * @param typeName The root type to expand
     * @param typedefs Array of type definitions (from rosapi)
     */
    static expandTypeDef(typeName: string, typedefs: rosapi.TypeDef[]): ExpandedTypeDef {
        const typedef = typedefs.find((t) => t.type === typeName);
        if (!typedef) {
            return typeName;
        }

        const result: { [key: string]: ExpandedTypeDef | ExpandedTypeDef[] } = {};
        for (let i = 0; i < typedef.fieldnames.length; i++) {
            const name = typedef.fieldnames[i];
            const type = typedef.fieldtypes[i];
            const arrayLen = typedef.fieldarraylen[i];

            let expandedType: ExpandedTypeDef;
            if (type === typeName) {
                expandedType = type;
            } else {
                expandedType = this.expandTypeDef(type, typedefs);
            }

            if (arrayLen !== -1) {
                result[name] = [expandedType];
            } else {
                result[name] = expandedType;
            }
        }
        return result;
    }

    /**
     * Resolves the full structure of a ROS node: every topic it publishes or
     * subscribes to, every service it offers and every action server it
     * provides, each with its expanded type definition. The internal
     * `_action` services and topics are folded into the action entries.
     * Failures on individual entries (e.g. internal services that rosapi
     * cannot introspect) are reported per entry instead of failing the
     * whole lookup.
     */
    static async getNodeDefinition(ros: Ros, nodeName: string): Promise<NodeDefinition> {
        const details = await this.getNodeDetails(ros, nodeName);

        // Action servers surface in node details only through their internal
        // `<action>/_action/*` services and topics. Detect them via the
        // send_goal service and report each action once with its expanded
        // goal/result/feedback instead of the raw internals.
        const allServices = details.services ?? [];
        const actionServers = allServices
            .filter((service) => service.endsWith('/_action/send_goal'))
            .map((service) => service.slice(0, -'/_action/send_goal'.length));
        const isActionInternal = (name: string) =>
            actionServers.some((action) => name.startsWith(`${action}/_action/`));

        // Nodes often share types (e.g. rcl_interfaces parameter services),
        // so resolve each distinct type only once.
        const messageDefinitions = new Map<string, Promise<ExpandedTypeDef>>();
        const serviceDefinitions = new Map<string, Promise<{ request: ExpandedTypeDef; response: ExpandedTypeDef }>>();

        const describeTopic = async (name: string): Promise<NodeTopicDefinition> => {
            try {
                const type = await this.getTopicType(ros, name);
                let definition = messageDefinitions.get(type);
                if (!definition) {
                    definition = this.getMessageDetails(ros, type).then((typedefs) =>
                        this.expandRootTypeDef(type, typedefs),
                    );
                    messageDefinitions.set(type, definition);
                }
                return { name, type, definition: await definition };
            } catch (error) {
                return { name, error: (error as Error).message };
            }
        };

        const describeService = async (name: string): Promise<NodeServiceDefinition> => {
            try {
                const type = await this.getServiceType(ros, name);
                let definition = serviceDefinitions.get(type);
                if (!definition) {
                    definition = Promise.all([
                        this.getServiceRequestDetails(ros, type),
                        this.getServiceResponseDetails(ros, type),
                    ]).then(([requestDetails, responseDetails]) => ({
                        request: this.expandRootTypeDef(type, requestDetails),
                        response: this.expandRootTypeDef(type, responseDetails),
                    }));
                    serviceDefinitions.set(type, definition);
                }
                return { name, type, ...(await definition) };
            } catch (error) {
                return { name, error: (error as Error).message };
            }
        };

        const describeAction = async (name: string): Promise<NodeActionDefinition> => {
            try {
                const type = await this.getActionType(ros, name);
                if (!type) {
                    return { name, error: 'Could not determine action type' };
                }
                const [goalDetails, resultDetails, feedbackDetails] = await Promise.all([
                    this.getActionGoalDetails(ros, type),
                    this.getActionResultDetails(ros, type),
                    this.getActionFeedbackDetails(ros, type),
                ]);
                return {
                    name,
                    type,
                    goal: this.expandRootTypeDef(type, goalDetails),
                    result: this.expandRootTypeDef(type, resultDetails),
                    feedback: this.expandRootTypeDef(type, feedbackDetails),
                };
            } catch (error) {
                return { name, error: (error as Error).message };
            }
        };

        const [publishing, subscribing, services, actions] = await Promise.all([
            Promise.all((details.publishing ?? []).filter((topic) => !isActionInternal(topic)).map(describeTopic)),
            Promise.all((details.subscribing ?? []).filter((topic) => !isActionInternal(topic)).map(describeTopic)),
            Promise.all(allServices.filter((service) => !isActionInternal(service)).map(describeService)),
            Promise.all(actionServers.map(describeAction)),
        ]);

        return { publishing, subscribing, services, actions };
    }

    static async getTopicsAndRawTypes(ros: Ros): Promise<rosapi.TopicsAndRawTypesResponse> {
        return this.request('/rosapi/topics_and_raw_types', (onSuccess, onError) => {
            ros.getTopicsAndRawTypes(onSuccess, (error) => onError(new Error(error)));
        });
    }

    static async getParams(ros: Ros): Promise<string[]> {
        return this.request('/rosapi/get_param_names', (onSuccess, onError) => {
            ros.getParams(onSuccess, (error) => onError(new Error(error)));
        });
    }

    /**
     * Reads a parameter through `/rosapi/get_param`. roslib's `Param` wrapper
     * is deliberately not used: its failure callback defaults to
     * `console.error`, so a failed service call (rosbridge answering with
     * "Timeout exceeded while waiting for service response", typically after
     * rosapi died) would be swallowed and the caller left waiting forever.
     */
    static async getParam(ros: Ros, name: string): Promise<unknown> {
        const response = await this.callRosapi<{ name: string }, RosapiParamResponse>(ros, 'get_param', 'GetParam', {
            name,
        });
        this.assertParamSucceeded(response, `read ROS parameter "${name}"`);

        const value = response?.value;
        if (value === undefined || value === null || value === '') {
            // rosapi answers with an empty value for parameters it cannot find.
            return null;
        }
        try {
            return JSON.parse(value) as unknown;
        } catch {
            // Not every parameter server round-trips valid JSON; keep the raw text.
            return value;
        }
    }

    static async setParam(ros: Ros, name: string, value: unknown): Promise<void> {
        const response = await this.callRosapi<{ name: string; value: string }, RosapiParamResponse>(
            ros,
            'set_param',
            'SetParam',
            { name, value: JSON.stringify(value) },
        );
        this.assertParamSucceeded(response, `set ROS parameter "${name}"`);
    }

    /**
     * Newer rosapi builds report parameter failures in the response instead of
     * failing the service call, which roslib's `Param` treats as an error too.
     */
    private static assertParamSucceeded(response: RosapiParamResponse | undefined, action: string): void {
        if (response && response.successful === false) {
            throw new Error(`Could not ${action}: ${response.reason || 'rosapi reported failure'}`);
        }
    }
}
