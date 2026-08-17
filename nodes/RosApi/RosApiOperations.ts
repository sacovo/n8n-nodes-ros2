import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { Ros } from 'roslib';

import { RosApiService } from '../shared/services/RosApiService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';

export type RosResource = 'action' | 'node' | 'parameter' | 'service' | 'topic';
export type RosOperation = 'list' | 'getDetails' | 'get' | 'set' | 'getType' | 'listForType' | 'getDefinition';

/**
 * Resource/operation combinations that change the state of the ROS graph.
 * Everything else only reads it (listing, resolving types and definitions),
 * which a read-only credential is allowed to do.
 */
const WRITE_OPERATIONS = new Set<`${RosOperation}:${RosResource}`>(['set:parameter']);

/** Whether the combination writes to the ROS graph. */
export function isWriteOperation(resource: RosResource, operation: RosOperation): boolean {
    return WRITE_OPERATIONS.has(`${operation}:${resource}`);
}

/**
 * Filters text against a user-supplied pattern, treating it as a
 * case-insensitive regular expression and falling back to a plain substring
 * match if the pattern is not a valid regex.
 */
function matchesPattern(text: string, pattern: string): boolean {
    try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(text);
    } catch {
        return text.toLowerCase().includes(pattern.toLowerCase());
    }
}

/** Reads a resourceLocator parameter that may also be a plain string. */
function extractLocator(node: IExecuteFunctions, itemIndex: number, name: string): string {
    const locator = node.getNodeParameter(name, itemIndex, '') as { mode?: string; value?: string } | string;
    const value = typeof locator === 'string' ? locator : locator?.value ?? '';
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Builds the `<node>:<parameter>` name rosapi expects. ROS 2 parameters belong
 * to a node, and rosapi splits the name on ":" - handing it anything else
 * leaves its handler with unbound names, so it never answers at all and the
 * call only ends in rosbridge's service timeout.
 */
function resolveParameterName(node: IExecuteFunctions, itemIndex: number): string {
    const parameterName = extractLocator(node, itemIndex, 'parameterName');
    if (!parameterName) {
        throw new NodeOperationError(node.getNode(), 'Parameter Name is required', { itemIndex });
    }

    const nodeName = extractLocator(node, itemIndex, 'parameterNodeName');
    const qualified = parameterName.includes(':') ? parameterName : `${nodeName}:${parameterName}`;

    const [owner, ...rest] = qualified.split(':');
    if (!owner || rest.length !== 1 || !rest[0]) {
        throw new NodeOperationError(
            node.getNode(),
            `"${parameterName}" is not a usable ROS 2 parameter name. Select the owning node above, or enter the fully qualified name as "<node>:<parameter>" (e.g. "/talker:max_vel_x"). The "list" operation shows the available names.`,
            { itemIndex },
        );
    }
    return qualified;
}

/**
 * Dispatches a resource/operation combination to the matching rosapi call and
 * returns the JSON payload to merge into the node output.
 */
export async function runOperation(
    resource: RosResource,
    operation: RosOperation,
    ros: Ros,
    node: IExecuteFunctions,
    itemIndex: number,
) {
    const actionKey: `${RosOperation}:${RosResource}` = `${operation}:${resource}`;
    switch (actionKey) {
        case 'list:topic':
            {
                const topicsResult = await RosApiService.getTopics(ros);
                let topics = topicsResult.topics;
                let types = topicsResult.types;
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    const filteredTopics: string[] = [];
                    const filteredTypes: string[] = [];
                    for (let idx = 0; idx < topics.length; idx++) {
                        const topic = topics[idx];
                        const type = types[idx];
                        if (matchesPattern(topic, grep) || (type && matchesPattern(type, grep))) {
                            filteredTopics.push(topic);
                            if (types.length > idx) {
                                filteredTypes.push(type);
                            }
                        }
                    }
                    topics = filteredTopics;
                    types = filteredTypes;
                }
                const combineTopicsAndTypes = node.getNodeParameter('combineTopicsAndTypes', itemIndex, false) as boolean;
                if (combineTopicsAndTypes) {
                    return {
                        topics: topics.map((topic, idx) => ({ name: topic, type: types[idx] })),
                    };
                }
                return {
                    topics,
                    types,
                };
            }
        case 'list:service':
            {
                let services = await RosApiService.getServices(ros);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    services = services.filter(service => matchesPattern(service, grep));
                }
                return {
                    services,
                };
            }
        case 'list:node':
            {
                let nodes = await RosApiService.getNodes(ros);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    nodes = nodes.filter(n => matchesPattern(n, grep));
                }
                return {
                    nodes,
                };
            }
        case 'list:action':
            {
                let actionServers = await RosApiService.getActionServers(ros);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    actionServers = actionServers.filter(action => matchesPattern(action, grep));
                }
                return {
                    actionServers,
                };
            }
        case 'list:parameter':
            {
                let parameters = await RosApiService.getParams(ros);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    parameters = parameters.filter(param => matchesPattern(param, grep));
                }
                return {
                    parameters,
                };
            }
        case 'getType:topic':
            {
                const topicName = ParameterExtractor.extractRequiredString(node, itemIndex, 'topicName');
                const topicType = await RosApiService.getTopicType(ros, topicName);
                const result: Record<string, unknown> = {
                    topicName,
                    topicType,
                };
                if (node.getNodeParameter('includeDescription', itemIndex, false) as boolean) {
                    result.description = await RosApiService.getInterfaceDescription(ros, topicName);
                }
                if (node.getNodeParameter('includeRawDefinition', itemIndex, false) as boolean) {
                    result.rawDefinition = await RosApiService.getTopicRawDefinition(ros, topicName, topicType);
                }
                return result;
            }
        case 'getDetails:node':
            {
                const nodeName = ParameterExtractor.extractRequiredString(node, itemIndex, 'nodeName');
                const nodeDetails = await RosApiService.getNodeDetails(ros, nodeName);
                return {
                    nodeName,
                    ...nodeDetails,
                };
            }
        case 'get:parameter':
            {
                const parameterName = resolveParameterName(node, itemIndex);
                const parameterValue = await RosApiService.getParam(ros, parameterName);
                return {
                    parameterName,
                    parameterValue,
                };
            }
        case 'set:parameter':
            {
                const parameterName = resolveParameterName(node, itemIndex);
                const parameterValueRaw = ParameterExtractor.extractRequiredString(node, itemIndex, 'parameterValue');
                let parameterValue: unknown;
                try {
                    parameterValue = JSON.parse(parameterValueRaw);
                } catch {
                    // If parsing fails, treat it as a string
                    parameterValue = parameterValueRaw;
                }
                await RosApiService.setParam(ros, parameterName, parameterValue);
                return {
                    parameterName,
                    parameterValue,
                    status: 'success',
                };
            }
        case 'getType:service':
            {
                const serviceName = ParameterExtractor.extractRequiredString(node, itemIndex, 'serviceName');
                const serviceType = await RosApiService.getServiceType(ros, serviceName);
                const result: Record<string, unknown> = {
                    serviceName,
                    serviceType,
                };
                if (node.getNodeParameter('includeDescription', itemIndex, false) as boolean) {
                    result.description = await RosApiService.getInterfaceDescription(ros, serviceName);
                }
                return result;
            }
        case 'getType:action':
            {
                const actionName = ParameterExtractor.extractRequiredString(node, itemIndex, 'actionName');
                const actionType = await RosApiService.getActionType(ros, actionName);
                if (!actionType) {
                    throw new NodeApiError(node.getNode(), { message: `Could not determine the action type of ${actionName}. Is the action server running?` });
                }
                const result: Record<string, unknown> = {
                    actionName,
                    actionType,
                };
                if (node.getNodeParameter('includeDescription', itemIndex, false) as boolean) {
                    result.description = await RosApiService.getInterfaceDescription(ros, actionName);
                }
                return result;
            }
        case 'getDefinition:topic':
            {
                let messageType = ParameterExtractor.extractOptionalString(node, itemIndex, 'messageType');
                if (!messageType) {
                    const topicName = ParameterExtractor.extractRequiredString(node, itemIndex, 'topicName');
                    messageType = await RosApiService.getTopicType(ros, topicName);
                }
                const typedefs = await RosApiService.getMessageDetails(ros, messageType as string);
                const definition = RosApiService.expandRootTypeDef(messageType as string, typedefs);
                return {
                    messageType,
                    definition,
                };
            }
        case 'getDefinition:service':
            {
                let serviceType = ParameterExtractor.extractOptionalString(node, itemIndex, 'messageType');
                if (!serviceType) {
                    const serviceName = ParameterExtractor.extractRequiredString(node, itemIndex, 'serviceName');
                    serviceType = await RosApiService.getServiceType(ros, serviceName);
                }
                const [requestDetails, responseDetails] = await Promise.all([
                    RosApiService.getServiceRequestDetails(ros, serviceType as string),
                    RosApiService.getServiceResponseDetails(ros, serviceType as string),
                ]);
                return {
                    serviceType,
                    request: RosApiService.expandRootTypeDef(serviceType as string, requestDetails),
                    response: RosApiService.expandRootTypeDef(serviceType as string, responseDetails),
                };
            }
        case 'getDefinition:action':
            {
                let actionType = ParameterExtractor.extractOptionalString(node, itemIndex, 'messageType');
                if (!actionType) {
                    const actionName = ParameterExtractor.extractOptionalString(node, itemIndex, 'actionName');
                    if (actionName) {
                        actionType = await RosApiService.getActionType(ros, actionName);
                    }
                }
                if (!actionType) {
                    throw new NodeApiError(node.getNode(), { message: 'Provide either Action Name or Message Type for getDefinition:action' });
                }
                const [goalDetails, resultDetails, feedbackDetails] = await Promise.all([
                    RosApiService.getActionGoalDetails(ros, actionType as string),
                    RosApiService.getActionResultDetails(ros, actionType as string),
                    RosApiService.getActionFeedbackDetails(ros, actionType as string),
                ]);

                return {
                    actionType,
                    goal: RosApiService.expandRootTypeDef(actionType as string, goalDetails),
                    result: RosApiService.expandRootTypeDef(actionType as string, resultDetails),
                    feedback: RosApiService.expandRootTypeDef(actionType as string, feedbackDetails),
                };
            }
        case 'getDefinition:node':
            {
                const nodeName = ParameterExtractor.extractRequiredString(node, itemIndex, 'nodeName');
                const nodeDefinition = await RosApiService.getNodeDefinition(ros, nodeName);
                return {
                    nodeName,
                    ...nodeDefinition,
                };
            }
        case 'getDetails:topic':
            {
                const topicName = ParameterExtractor.extractRequiredString(node, itemIndex, 'topicName');
                // message_details expects a type, so resolve the topic's type first
                const topicType = await RosApiService.getTopicType(ros, topicName);
                const typedefs = await RosApiService.getMessageDetails(ros, topicType);
                return {
                    topicName,
                    topicType,
                    typedefs,
                };
            }

        case 'listForType:topic':
            {
                const messageType = ParameterExtractor.extractRequiredString(node, itemIndex, 'messageType');
                let topics = await RosApiService.getTopicsForType(ros, messageType);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    topics = topics.filter(topic => matchesPattern(topic, grep));
                }
                return {
                    messageType,
                    topics,
                };
            }
        case 'listForType:service':
            {
                const messageType = ParameterExtractor.extractRequiredString(node, itemIndex, 'messageType');
                let services = await RosApiService.getServicesForType(ros, messageType);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    services = services.filter(service => matchesPattern(service, grep));
                }
                return {
                    messageType,
                    services,
                };
            }

        default:
            throw new NodeApiError(node.getNode(), { message: `Unsupported operation: ${operation}:${resource}!` });
    }
}
