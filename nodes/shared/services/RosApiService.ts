/**
 * RosApiService - ROS API query operations
 * This service handles ROS system queries like getting topics, services, etc.
 */

import type { Ros, rosapi } from 'roslib';

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

export interface NodeDefinition {
    publishing: NodeTopicDefinition[];
    subscribing: NodeTopicDefinition[];
    services: NodeServiceDefinition[];
    actions: NodeActionDefinition[];
}

export class RosApiService {
    private static loadRoslib() {
        // We use eval('import(...)') to prevent tsc from transpiling this to require(),
        // as roslib 2.x is an ESM-only package and doesn't support require().
        return (0, eval)('import("roslib")') as Promise<typeof import('roslib')>;
    }

    static async getTopics(ros: Ros): Promise<rosapi.TopicsResponse> {
        return new Promise<rosapi.TopicsResponse>((resolve, reject) => {
            ros.getTopics(
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getNodes(ros: Ros): Promise<string[]> {
        return new Promise<string[]>((resolve, reject) => {
            ros.getNodes(
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getNodeDetails(ros: Ros, node: string): Promise<rosapi.NodeDetailsResponse> {
        return new Promise<rosapi.NodeDetailsResponse>((resolve, reject) => {
            ros.getNodeDetails(
                node,
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getServices(ros: Ros): Promise<string[]> {
        return new Promise<string[]>((resolve, reject) => {
            ros.getServices(
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getActionServers(ros: Ros): Promise<string[]> {
        return new Promise<string[]>((resolve, reject) => {
            ros.getActionServers(
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getTopicsForType(ros: Ros, topicType: string): Promise<string[]> {
        return new Promise<string[]>((resolve, reject) => {
            ros.getTopicsForType(
                topicType,
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getServicesForType(ros: Ros, serviceType: string): Promise<string[]> {
        return new Promise<string[]>((resolve, reject) => {
            ros.getServicesForType(
                serviceType,
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getTopicType(ros: Ros, topic: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            ros.getTopicType(
                topic,
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getServiceType(ros: Ros, service: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            ros.getServiceType(
                service,
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getActionType(ros: Ros, actionServer: string): Promise<string> {
        // In ROS 2, action servers have a set of services. 
        // We can try to get the type from the 'send_goal' service.
        const sendGoalService = actionServer.endsWith('/') 
            ? `${actionServer}_action/send_goal` 
            : `${actionServer}/_action/send_goal`;
        
        try {
            const serviceType = await this.getServiceType(ros, sendGoalService);
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
        return new Promise<rosapi.TypeDef[]>((resolve, reject) => {
            ros.getMessageDetails(
                message,
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getServiceRequestDetails(ros: Ros, type: string): Promise<rosapi.TypeDef[]> {
        return new Promise<rosapi.TypeDef[]>((resolve, reject) => {
            ros.getServiceRequestDetails(
                type,
                (result) => resolve(result.typedefs),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getServiceResponseDetails(ros: Ros, type: string): Promise<rosapi.TypeDef[]> {
        return new Promise<rosapi.TypeDef[]>((resolve, reject) => {
            ros.getServiceResponseDetails(
                type,
                (result) => resolve(result.typedefs),
                (error) => reject(new Error(error)),
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

    private static async callRosapiService(ros: Ros, serviceName: string, serviceType: string, type: string): Promise<rosapi.TypeDef[]> {
        const { Service } = await this.loadRoslib();

        return new Promise<rosapi.TypeDef[]>((resolve, reject) => {
            // roslib v2 services take a plain request object directly (there is
            // no `ServiceRequest` wrapper class, unlike roslib v1).
            const client = new Service<{ type: string }, unknown>({
                ros,
                name: `/rosapi/${serviceName}`,
                serviceType: `rosapi/${serviceType}`,
            });
            client.callService(
                { type },
                (result) => {
                    if (result && typeof result === 'object' && Array.isArray((result as { typedefs?: unknown }).typedefs)) {
                        resolve((result as { typedefs: rosapi.TypeDef[] }).typedefs);
                    } else if (Array.isArray(result)) {
                        resolve(result as rosapi.TypeDef[]);
                    } else {
                        resolve([]);
                    }
                },
                (error) => reject(new Error(error)),
            );
        });
    }

    /**
     * Expands a ROS message definition by recursively resolving nested types.
     * @param typeName The root type to expand
     * @param typedefs Array of type definitions (from rosapi)
     */
    static expandTypeDef(typeName: string, typedefs: rosapi.TypeDef[]): ExpandedTypeDef {
        const typedef = typedefs.find(t => t.type === typeName);
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
                    definition = this.getMessageDetails(ros, type).then((typedefs) => this.expandTypeDef(type, typedefs));
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
                        request: this.expandTypeDef(type, requestDetails),
                        response: this.expandTypeDef(type, responseDetails),
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
                    goal: this.expandTypeDef(type, goalDetails),
                    result: this.expandTypeDef(type, resultDetails),
                    feedback: this.expandTypeDef(type, feedbackDetails),
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
        return new Promise<rosapi.TopicsAndRawTypesResponse>((resolve, reject) => {
            ros.getTopicsAndRawTypes(
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getParams(ros: Ros): Promise<string[]> {
        return new Promise<string[]>((resolve, reject) => {
            ros.getParams(
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
    }

    static async getParam(ros: Ros, name: string): Promise<unknown> {
        const { Param } = await this.loadRoslib();
        const param = new Param({ ros, name });
        return new Promise((resolve) => {
            param.get((value) => resolve(value));
        });
    }

    static async setParam(ros: Ros, name: string, value: unknown): Promise<void> {
        const { Param } = await this.loadRoslib();
        const param = new Param({ ros, name });
        return new Promise((resolve) => {
            param.set(value, () => resolve());
        });
    }
}
