import type { INodeProperties } from 'n8n-workflow';

/**
 * Property (UI) definitions for the ROS2 API node. Kept separate from the
 * node class so the executable logic stays readable.
 */
export const rosApiProperties: INodeProperties[] = [
    {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        default: 'topic',
        noDataExpression: true,
        options: [
            { name: 'Action', value: 'action' },
            { name: 'Node', value: 'node' },
            { name: 'Parameter', value: 'parameter' },
            { name: 'Service', value: 'service' },
            { name: 'Topic', value: 'topic' },
        ],
        required: true,
    },
    {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: {
            show: {
                resource: ['action'],
            },
        },
        options: [
            {
                name: 'Get Definition', value: 'getDefinition',
                action: 'Get the expanded definition of an action',
                description: 'Get the expanded goal, result and feedback structure of an action type',
            },
            {
                name: 'Get Type', value: 'getType',
                action: 'Get the type of an action',
                description: 'Get the action type of an action server by its name, optionally with its documentation (description)',
            },
            {
                name: 'List', value: 'list',
                action: 'List action servers',
                description: 'List all available action servers',
            },
        ],
        default: 'list',
        noDataExpression: true,
        required: true,
    },
    {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: {
            show: {
                resource: ['node'],
            },
        },
        options: [
            {
                name: 'Get Definition', value: 'getDefinition',
                action: 'Get the expanded definitions of all topics and services of a node',
                description: 'Get every topic, service and action of a node together with the expanded structure of their message types',
            },
            {
                name: 'Get Details', value: 'getDetails',
                action: 'Get details of a node',
                description: 'List the names of the topics and services of a node',
            },
            {
                name: 'List', value: 'list',
                action: 'List nodes',
                description: 'List all running nodes',
            },
        ],
        default: 'list',
        noDataExpression: true,
        required: true,
    },
    {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: {
            show: {
                resource: ['parameter'],
            },
        },
        options: [
            {
                name: 'Get', value: 'get',
                action: 'Get a parameter',
                description: 'Get the value of a parameter',
            },
            {
                name: 'List', value: 'list',
                action: 'List parameters',
                description: 'List all parameter names',
            },
            {
                name: 'Set', value: 'set',
                action: 'Set a parameter',
                description: 'Set the value of a parameter',
            },
        ],
        default: 'list',
        noDataExpression: true,
        required: true,
    },
    {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: {
            show: {
                resource: ['service'],
            },
        },
        options: [
            {
                name: 'Get Definition', value: 'getDefinition',
                action: 'Get the expanded definition of a service',
                description: 'Get the expanded request and response structure of a service, so you know which fields a call expects and returns',
            },
            {
                name: 'Get Type', value: 'getType',
                action: 'Get the type of a service',
                description: 'Get the service type of a service by its name, optionally with its documentation (description)',
            },
            {
                name: 'List', value: 'list',
                action: 'List services',
                description: 'List all available services',
            },
            {
                name: 'List for Type', value: 'listForType',
                action: 'List services of a type',
                description: 'List all services that use a given service type',
            },
        ],
        default: 'list',
        noDataExpression: true,
        required: true,
    },
    {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: {
            show: {
                resource: ['topic'],
            },
        },
        options: [
            {
                name: 'Get Definition', value: 'getDefinition',
                action: 'Get the expanded definition of a topic message type',
                description: 'Get the expanded message structure of a topic, so you know which fields to publish or expect when subscribing',
            },
            {
                name: 'Get Details', value: 'getDetails',
                action: 'Get details of a topic',
                description: 'Get the raw type definitions of a topic message type',
            },
            {
                name: 'Get Type', value: 'getType',
                action: 'Get the type of a topic',
                description: 'Get the message type of a topic by its name, optionally with its documentation (description and raw message definition including comments)',
            },
            {
                name: 'List', value: 'list',
                action: 'List topics',
                description: 'List all available topics and their message types',
            },
            {
                name: 'List for Type', value: 'listForType',
                action: 'List topics of a type',
                description: 'List all topics that use a given message type',
            },
        ],
        default: 'list',
        noDataExpression: true,
        required: true,
    },
    {
        displayName: 'Node Name',
        name: 'nodeName',
        type: 'string',
        default: '',
        required: true,
        placeholder: '/talker',
        displayOptions: {
            show: {
                resource: ['node'],
                operation: ['getDetails', 'getDefinition'],
            },
        },
    },
    {
        displayName: 'Topic Name',
        name: 'topicName',
        type: 'string',
        default: '',
        required: true,
        placeholder: '/chatter',
        displayOptions: {
            show: {
                resource: ['topic'],
                operation: ['getType', 'getDetails', 'getDefinition'],
            },
        },
    },
    {
        displayName: 'Service Name',
        name: 'serviceName',
        type: 'string',
        default: '',
        required: true,
        placeholder: '/add_two_ints',
        displayOptions: {
            show: {
                resource: ['service'],
                operation: ['getType', 'getDefinition'],
            },
        },
    },
    {
        displayName: 'Action Name',
        name: 'actionName',
        type: 'string',
        default: '',
        placeholder: '/fibonacci',
        displayOptions: {
            show: {
                resource: ['action'],
                operation: ['getDefinition'],
            },
        },
        description: 'The action server name. Used to infer the action type if Message Type is not provided.',
    },
    {
        displayName: 'Action Name',
        name: 'actionName',
        type: 'string',
        default: '',
        required: true,
        placeholder: '/fibonacci',
        displayOptions: {
            show: {
                resource: ['action'],
                operation: ['getType'],
            },
        },
    },
    {
        displayName: 'Node',
        name: 'parameterNodeName',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        description: 'The node that owns the parameter. ROS 2 parameters live on a node, so rosapi addresses them as "&lt;node&gt;:&lt;parameter&gt;". Leave empty only if you enter a fully qualified parameter name below.',
        displayOptions: {
            show: {
                resource: ['parameter'],
                operation: ['get', 'set'],
            },
        },
        modes: [
            {
                displayName: 'From List',
                name: 'list',
                type: 'list',
                typeOptions: {
                    searchListMethod: 'getNodesList',
                    searchable: true,
                },
            },
            {
                displayName: 'ID (Manual)',
                name: 'id',
                type: 'string',
                placeholder: 'e.g. /talker',
            },
        ],
    },
    {
        displayName: 'Parameter Name',
        name: 'parameterName',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        description: 'Select one of the parameters of the node above, or enter a name manually. A manual name may be either the bare parameter (combined with the node above) or the fully qualified "&lt;node&gt;:&lt;parameter&gt;".',
        typeOptions: {
            loadOptionsDependsOn: ['parameterNodeName'],
        },
        displayOptions: {
            show: {
                resource: ['parameter'],
                operation: ['get', 'set'],
            },
        },
        modes: [
            {
                displayName: 'From List',
                name: 'list',
                type: 'list',
                typeOptions: {
                    searchListMethod: 'getParametersList',
                    searchable: true,
                },
            },
            {
                displayName: 'ID (Manual)',
                name: 'id',
                type: 'string',
                placeholder: 'e.g. max_vel_x or /talker:max_vel_x',
            },
        ],
    },
    {
        displayName: 'Parameter Value',
        name: 'parameterValue',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
            show: {
                resource: ['parameter'],
                operation: ['set'],
            },
        },
        description: 'The value to set. Can be a string, number, boolean, or JSON array/object.',
    },
    {
        displayName: 'Message Type',
        name: 'messageType',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'std_msgs/String',
        displayOptions: {
            show: {
                operation: ['listForType'],
                resource: ['topic', 'service'],
            },
        },
    },
    {
        displayName: 'Message Type',
        name: 'messageType',
        type: 'string',
        default: '',
        placeholder: 'std_msgs/String',
        displayOptions: {
            show: {
                operation: ['getDefinition'],
                resource: ['topic', 'service', 'action'],
            },
        },
        description: 'The ROS type (e.g., std_msgs/String). If not provided, it will be inferred from the name.',
    },
    {
        displayName: 'Include Description',
        name: 'includeDescription',
        type: 'boolean',
        default: false,
        displayOptions: {
            show: {
                resource: ['topic', 'service', 'action'],
                operation: ['getType'],
            },
        },
        description: 'Whether to also read the latched &lt;name&gt;/desc documentation topic (std_msgs/String, published by the node owning this interface) and return its text as "description". Null when the interface is undocumented.',
    },
    {
        displayName: 'Include Raw Definition',
        name: 'includeRawDefinition',
        type: 'boolean',
        default: false,
        displayOptions: {
            show: {
                resource: ['topic'],
                operation: ['getType'],
            },
        },
        description: 'Whether to also return the raw message definition text as written in the .msg source, including comments that document units and allowed values. Only available for message types currently used by an active topic; null otherwise.',
    },
    {
        displayName: 'Grep Pattern',
        name: 'grep',
        type: 'string',
        default: '',
        displayOptions: {
            show: {
                operation: ['list', 'listForType'],
            },
        },
        description: 'Filter list results using a regular expression or plain text (case-insensitive)',
    },
    {
        displayName: 'Combine Topics and Types',
        name: 'combineTopicsAndTypes',
        type: 'boolean',
        default: false,
        displayOptions: {
            show: {
                resource: ['topic'],
                operation: ['list'],
            },
        },
        description: 'Whether to return a single "topics" array of { name, type } objects instead of the separate "topics" and "types" arrays. Avoids having to match items across two arrays by index.',
    },
];
