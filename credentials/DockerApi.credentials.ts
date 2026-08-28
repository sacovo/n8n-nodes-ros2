import type { ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

export class DockerApi implements ICredentialType {
    name = 'dockerApi';

    displayName = 'Docker API';

    documentationUrl = 'https://docs.docker.com/engine/api/';

    icon: Icon = 'file:../nodes/DockerContainer/docker.svg';

    properties: INodeProperties[] = [
        {
            displayName: 'Connection Type',
            name: 'connectionType',
            type: 'options',
            options: [
                {
                    name: 'Unix Socket',
                    value: 'socket',
                },
                {
                    name: 'HTTP',
                    value: 'http',
                },
            ],
            default: 'socket',
        },
        {
            displayName: 'Socket Path',
            name: 'socketPath',
            type: 'string',
            default: '/var/run/docker.sock',
            displayOptions: {
                show: {
                    connectionType: ['socket'],
                },
            },
        },
        {
            displayName: 'Protocol',
            name: 'protocol',
            type: 'options',
            options: [
                {
                    name: 'HTTP',
                    value: 'http',
                },
                {
                    name: 'HTTPS',
                    value: 'https',
                },
            ],
            default: 'http',
            displayOptions: {
                show: {
                    connectionType: ['http'],
                },
            },
        },
        {
            displayName: 'Host',
            name: 'host',
            type: 'string',
            default: 'localhost',
            displayOptions: {
                show: {
                    connectionType: ['http'],
                },
            },
        },
        {
            displayName: 'Port',
            name: 'port',
            type: 'number',
            default: 2375,
            displayOptions: {
                show: {
                    connectionType: ['http'],
                },
            },
        },
        {
            displayName: 'Authentication',
            name: 'authentication',
            type: 'options',
            options: [
                {
                    name: 'None',
                    value: 'none',
                },
                {
                    name: 'Basic Auth',
                    value: 'basicAuth',
                },
            ],
            default: 'none',
            displayOptions: {
                show: {
                    connectionType: ['http'],
                },
            },
        },
        {
            displayName: 'Username',
            name: 'username',
            type: 'string',
            default: '',
            displayOptions: {
                show: {
                    connectionType: ['http'],
                    authentication: ['basicAuth'],
                },
            },
        },
        {
            displayName: 'Password',
            name: 'password',
            type: 'string',
            typeOptions: {
                password: true,
            },
            default: '',
            displayOptions: {
                show: {
                    connectionType: ['http'],
                    authentication: ['basicAuth'],
                },
            },
        },
        {
            displayName: 'Read-Only',
            name: 'readOnly',
            type: 'boolean',
            default: false,
            description:
                'Whether this credential may only inspect Docker. Listing containers and reading logs stay available; starting, stopping and restarting a container and executing commands inside one fail with an error.',
        },
    ];
}
