/**
 * Utility functions for formatting ROS data for n8n UI resource elements
 */

import type { FieldType, INodePropertyOptions, ResourceMapperFields } from 'n8n-workflow';
import { rosapi } from 'roslib';

export class RosN8nFormatter {
    static formatTopicMessage(topicName: string, messageType: string, message: unknown): import("n8n-workflow").IDataObject {
        return {
            topic: topicName,
            messageType,
            message: message as Record<string, unknown>,
            receivedAt: new Date().toISOString(),
        };
    }
    /**
     * Maps ROS message field types to n8n ResourceMapper field types
     */
    static mapRosTypeToN8nFieldType(rosType: string): FieldType {
        const normalizedType = rosType.trim().toLowerCase();

        if (normalizedType.endsWith('[]')) {
            return 'array';
        }

        const typeMap: Record<string, FieldType> = {
            // Primitive types
            bool: 'boolean',
            boolean: 'boolean',
            int8: 'number',
            uint8: 'number',
            int16: 'number',
            uint16: 'number',
            int32: 'number',
            uint32: 'number',
            int64: 'number',
            uint64: 'number',
            float32: 'number',
            float64: 'number',
            float: 'number',
            double: 'number',
            byte: 'number',
            char: 'number',
            string: 'string',
            time: 'string',
            duration: 'string',
            // Common geometry types
            'geometry_msgs/point': 'object',
            'geometry_msgs/quaternion': 'object',
            'geometry_msgs/twist': 'object',
            'geometry_msgs/pose': 'object',
            'sensor_msgs/jointstate': 'object',
        };

        if (typeMap[normalizedType]) {
            return typeMap[normalizedType];
        }

        // Fallback for types containing numeric keywords
        if (
            normalizedType.includes('int') ||
            normalizedType.includes('float') ||
            normalizedType.includes('double') ||
            normalizedType === 'byte'
        ) {
            return 'number';
        }

        return 'object';
    }

    /**
     * Formats topic list from getRosTopics into n8n dropdown options
     */
    static formatTopicListForN8n(topics: string[], filter?: string): INodePropertyOptions[] {
        return topics
            .filter((topic) => topic && typeof topic === 'string')
            .filter((topic) => !filter || topic.toLowerCase().includes(filter.toLowerCase()))
            .map((topic) => ({
                name: topic,
                value: topic,
            }));
    }

    /**
     * Formats service list from getRosServices into n8n dropdown options
     */
    static formatServiceListForN8n(services: string[], filter?: string): INodePropertyOptions[] {
        return services
            .filter((service) => service && typeof service === 'string')
            .filter((service) => !filter || service.toLowerCase().includes(filter.toLowerCase()))
            .map((service) => ({
                name: service,
                value: service,
            }));
    }

    /**
     * Formats action server list from getRosActionServers into n8n dropdown options
     */
    static formatActionListForN8n(actions: string[], filter?: string): INodePropertyOptions[] {
        return actions
            .filter((action) => action && typeof action === 'string')
            .filter((action) => !filter || action.toLowerCase().includes(filter.toLowerCase()))
            .map((action) => ({
                name: action,
                value: action,
            }));
    }

    /**
     * Converts ROS message TypeDef array to n8n ResourceMapperFields
     * Performs shallow expansion (1 level deep) for nested types
     */
    static getRosMessageStructure(typeDefs: rosapi.TypeDef[] | undefined): ResourceMapperFields {
        if (!typeDefs || typeDefs.length === 0) {
            return { fields: [] };
        }

        const mainType = typeDefs[0];
        if (!mainType || !mainType.fieldnames || !mainType.fieldtypes) {
            return { fields: [] };
        }

        const fields = mainType.fieldnames.map((fieldname, index) => {
            let fieldtype = (mainType.fieldtypes[index] || 'unknown').trim();
            const arrayLen = mainType.fieldarraylen?.[index] ?? -1;

            if (arrayLen !== -1 && !fieldtype.endsWith('[]')) {
                fieldtype += '[]';
            }

            const n8nType = this.mapRosTypeToN8nFieldType(fieldtype);

            return {
                id: fieldname,
                displayName: fieldname,
                type: n8nType,
                required: false,
                description: `ROS message field of type ${fieldtype}`,
                canBeUsedToMatch: false,
                defaultMatch: false,
                display: true,
            };
        });

        return { fields };
    }
}
