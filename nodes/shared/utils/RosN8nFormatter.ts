/**
 * Utility functions for formatting ROS data for n8n UI resource elements
 */

import type { FieldType, INodePropertyOptions, ResourceMapperFields } from 'n8n-workflow';
import { rosapi } from 'roslib';
import { RosApiService } from '../services/RosApiService';

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
     * Filters a list of ROS resource names by an optional case-insensitive
     * substring and maps them to n8n dropdown options.
     */
    private static formatListForN8n(names: string[], filter?: string): INodePropertyOptions[] {
        const needle = filter?.toLowerCase();
        return names
            .filter((name) => name && typeof name === 'string')
            .filter((name) => !needle || name.toLowerCase().includes(needle))
            .map((name) => ({
                name,
                value: name,
            }));
    }

    /**
     * Formats topic list from getRosTopics into n8n dropdown options
     */
    static formatTopicListForN8n(topics: string[], filter?: string): INodePropertyOptions[] {
        return this.formatListForN8n(topics, filter);
    }

    /**
     * Formats service list from getRosServices into n8n dropdown options
     */
    static formatServiceListForN8n(services: string[], filter?: string): INodePropertyOptions[] {
        return this.formatListForN8n(services, filter);
    }

    /**
     * Formats action server list from getRosActionServers into n8n dropdown options
     */
    static formatActionListForN8n(actions: string[], filter?: string): INodePropertyOptions[] {
        return this.formatListForN8n(actions, filter);
    }

    /**
     * Converts ROS message TypeDef array to n8n ResourceMapperFields.
     * Nested message types are fully expanded into the field description,
     * so the user can see which JSON structure a complex field expects.
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
            const baseType = (mainType.fieldtypes[index] || 'unknown').trim();
            const arrayLen = mainType.fieldarraylen?.[index] ?? -1;

            let fieldtype = baseType;
            if (arrayLen !== -1 && !fieldtype.endsWith('[]')) {
                fieldtype += '[]';
            }

            const n8nType = this.mapRosTypeToN8nFieldType(fieldtype);

            let description = `ROS message field of type ${fieldtype}`;
            // n8n's resource mapper does not render a per-field description or
            // hint below the input — the field label (displayName) is the only
            // text shown. So the type (and, for nested messages, the sub-field
            // names) are folded into the label to keep the structure visible.
            let displayName = `${fieldname} (${fieldtype})`;
            const expanded = RosApiService.expandTypeDef(baseType.replace(/\[\]$/, ''), typeDefs);
            if (typeof expanded !== 'string') {
                let structure = JSON.stringify(expanded);
                if (structure.length > 1000) {
                    structure = `${structure.slice(0, 1000)}…`;
                }
                description += `. Structure: ${structure}`;

                const keys = Object.keys(expanded);
                if (keys.length > 0) {
                    let shape = keys.join(', ');
                    if (shape.length > 60) {
                        shape = `${shape.slice(0, 60)}…`;
                    }
                    displayName += ` {${shape}}`;
                }
            }

            return {
                id: fieldname,
                displayName,
                type: n8nType,
                required: false,
                description,
                canBeUsedToMatch: false,
                defaultMatch: false,
                display: true,
            };
        });

        return { fields };
    }
}
