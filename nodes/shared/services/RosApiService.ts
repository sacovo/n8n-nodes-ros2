/**
 * RosApiService - ROS API query operations
 * This service handles ROS system queries like getting topics, services, etc.
 */

import type { Ros, rosapi } from 'roslib';

export type ExpandedTypeDef = string | { [key: string]: ExpandedTypeDef | ExpandedTypeDef[] };

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
