import type { ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

export class RosBridgeApi implements ICredentialType {
    name = 'rosBridgeApi';

    displayName = 'ROS2 Rosbridge API';

    documentationUrl = 'https://github.com/RobotWebTools/rosbridge_suite';

    icon: Icon = 'file:../nodes/shared/ros.svg';

    properties: INodeProperties[] = [
        {
            displayName: 'Protocol',
            name: 'protocol',
            type: 'options',
            default: 'ws',
            options: [
                { name: 'ws', value: 'ws' },
                { name: 'wss', value: 'wss' },
            ],
            description: 'WebSocket protocol used by rosbridge',
        },
        {
            displayName: 'Host',
            name: 'host',
            type: 'string',
            default: 'localhost',
            placeholder: 'localhost',
            required: true,
        },
        {
            displayName: 'Port',
            name: 'port',
            type: 'number',
            default: 9090,
            required: true,
        },
        {
            displayName: 'Path',
            name: 'path',
            type: 'string',
            default: '',
            placeholder: '/rosbridge',
            description: 'Optional path segment for the rosbridge endpoint',
        },
        {
            displayName: 'Auth Token',
            name: 'authToken',
            type: 'string',
            typeOptions: {
                password: true,
            },
            default: '',
            description: 'Optional token that is appended as a query parameter',
        },
        {
            displayName: 'Auth Query Parameter',
            name: 'authQueryParameter',
            type: 'string',
            default: 'token',
            description: 'Query parameter name used for Auth Token',
            displayOptions: {
                show: {
                    authToken: [{ _cnd: { exists: true } }],
                },
            },
        },
        {
            displayName: 'Connect Timeout (ms)',
            name: 'connectTimeoutMs',
            type: 'number',
            default: 5000,
            description: 'Maximum time to wait for WebSocket connection',
        },
    ];
}
