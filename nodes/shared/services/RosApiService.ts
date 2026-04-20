/**
 * RosApiService - ROS API query operations
 * This service handles ROS system queries like getting topics, services, etc.
 */

import type { Ros, rosapi } from 'roslib';

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

    static async getMessageDetails(ros: Ros, message: string): Promise<rosapi.TypeDef[]> {
        return new Promise<rosapi.TypeDef[]>((resolve, reject) => {
            ros.getMessageDetails(
                message,
                (result) => resolve(result),
                (error) => reject(new Error(error)),
            );
        });
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
