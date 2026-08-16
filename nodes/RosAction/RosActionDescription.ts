import type { INodeProperties } from 'n8n-workflow';

const serverAndTypeOperations = ['sendGoalAndWait', 'sendGoal', 'watchFeedback'];

export const rosActionProperties: INodeProperties[] = [
    {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        // Alphabetical, as n8n's linter requires; `default` below is what
        // actually preselects the common case.
        options: [
            {
                name: 'Cancel Goal',
                value: 'cancelGoal',
                description: 'Ask the action server to cancel a goal sent earlier by Send Goal',
                action: 'Cancel a goal',
            },
            {
                name: 'Get Result',
                value: 'getResult',
                description: 'Wait for the result of a goal sent earlier by Send Goal',
                action: 'Get the result of a goal',
            },
            {
                name: 'Send Goal',
                value: 'sendGoal',
                description: 'Send a goal and continue without waiting for the result',
                action: 'Send a goal without waiting',
            },
            {
                name: 'Send Goal and Wait',
                value: 'sendGoalAndWait',
                description: 'Send a goal and wait for the action to finish',
                action: 'Send a goal and wait for the result',
            },
            {
                name: 'Watch Feedback',
                value: 'watchFeedback',
                description: 'Wait for the next feedback message on the action server',
                action: 'Watch action feedback',
            },
            {
                name: 'Watch Status',
                value: 'watchStatus',
                description: 'Read the current status of every goal on the action server',
                action: 'Watch action status',
            },
        ],
        default: 'sendGoalAndWait',
    },
    {
        displayName: 'Action Server Name',
        name: 'serverName',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        description: 'Select from available action servers or enter manually',
        displayOptions: {
            hide: {
                operation: ['getResult', 'cancelGoal'],
            },
        },
        modes: [
            {
                displayName: 'From List',
                name: 'list',
                type: 'list',
                typeOptions: {
                    searchListMethod: 'getActionsList',
                    searchable: true,
                },
            },
            {
                displayName: 'ID (Manual)',
                name: 'id',
                type: 'string',
                placeholder: 'e.g., /fibonacci',
            },
        ],
    },
    {
        displayName: 'Action Type',
        name: 'actionType',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        description:
            'The ROS 2 action type (e.g. action_tutorials_interfaces/action/Fibonacci). "Detected" mode fetches the type from the selected server.',
        displayOptions: {
            show: {
                operation: serverAndTypeOperations,
            },
        },
        typeOptions: {
            loadOptionsDependsOn: ['serverName'],
        },
        modes: [
            {
                displayName: 'Detected',
                name: 'list',
                type: 'list',
                typeOptions: {
                    searchListMethod: 'getDetectedActionType',
                },
            },
            {
                displayName: 'Manual',
                name: 'id',
                type: 'string',
                placeholder: 'e.g., action_tutorials_interfaces/action/Fibonacci',
            },
        ],
    },
    {
        displayName: 'Goal Input Mode',
        name: 'goalInputMode',
        type: 'options',
        options: [
            {
                name: 'Raw (JSON)',
                value: 'raw',
                description: 'Provide raw JSON object for the goal',
            },
            {
                name: 'Fixed (Mapper)',
                value: 'fixed',
                description: 'Use the visual mapper to define goal fields',
            },
        ],
        default: 'raw',
        displayOptions: {
            show: {
                operation: ['sendGoalAndWait', 'sendGoal'],
            },
        },
    },
    {
        displayName: 'Goal Structure',
        name: 'goalStructure',
        type: 'resourceMapper',
        default: {
            mappingMode: 'defineBelow',
            value: null,
        },
        noDataExpression: true,
        required: true,
        displayOptions: {
            show: {
                operation: ['sendGoalAndWait', 'sendGoal'],
                goalInputMode: ['fixed'],
            },
        },
        typeOptions: {
            loadOptionsDependsOn: ['actionType'],
            resourceMapper: {
                resourceMapperMethod: 'getGoalFieldsForType',
                hideNoDataError: true,
                addAllFields: true,
                supportAutoMap: false,
                mode: 'add',
                fieldWords: {
                    singular: 'field',
                    plural: 'fields',
                },
            },
        },
    },
    {
        displayName: 'Goal JSON',
        name: 'goalJson',
        type: 'string',
        typeOptions: {
            rows: 6,
        },
        displayOptions: {
            show: {
                operation: ['sendGoalAndWait', 'sendGoal'],
                goalInputMode: ['raw'],
            },
        },
        default: '{}',
        hint: 'Prefer a guided form? Switch "Goal Input Mode" to "Fixed (Mapper)" to get every field of the selected action goal pre-filled and editable.',
        description:
            'JSON object sent as the action goal. The structure must match the goal part of the action type — use the ROS2 API node\'s "Get Definition" operation to discover the expected fields.',
    },
    {
        displayName: 'Goal Handle',
        name: 'goalHandle',
        type: 'string',
        default: '={{$json.goalHandle}}',
        required: true,
        displayOptions: {
            show: {
                operation: ['getResult', 'cancelGoal'],
            },
        },
        description:
            'The goalHandle returned by Send Goal. This is an n8n-side handle, not a ROS goal UUID: rosbridge never reports the UUID back, so a goal can only be resolved or cancelled by the same n8n process that sent it, and only before its result arrives.',
    },
    {
        displayName: 'Include Feedback',
        name: 'includeFeedback',
        type: 'boolean',
        default: false,
        displayOptions: {
            show: {
                operation: ['sendGoalAndWait', 'sendGoal'],
            },
        },
        description:
            'Whether to subscribe to the goal\'s feedback. When enabled, Send Goal and Wait returns every feedback message received while the goal ran.',
    },
    {
        displayName: 'Goal ID',
        name: 'goalId',
        type: 'string',
        default: '',
        displayOptions: {
            show: {
                operation: ['watchFeedback', 'watchStatus'],
            },
        },
        description:
            'Optional ROS goal UUID to filter for, as reported on the feedback/status topics. Leave empty to report every goal on the server.',
    },
    {
        displayName: 'Timeout (Ms)',
        name: 'timeoutMs',
        type: 'number',
        default: 60000,
        displayOptions: {
            show: {
                operation: ['sendGoalAndWait', 'getResult'],
            },
        },
        description:
            'Maximum time to wait for the result. On timeout the node errors but the goal keeps running on the robot — cancel it explicitly if that is not wanted.',
    },
    {
        displayName: 'Timeout (Ms)',
        name: 'watchTimeoutMs',
        type: 'number',
        default: 5000,
        displayOptions: {
            show: {
                operation: ['watchFeedback', 'watchStatus'],
            },
        },
        description: 'Maximum wait time for the next message on the feedback/status topic',
    },
];
