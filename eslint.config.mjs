import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	{
		// Vendored, pre-compiled n8n build shipped for the Docker image. It is not
		// our source and would otherwise flood lint with thousands of errors.
		ignores: ['docker/n8n/n8n-compiled/**'],
	},
	...configWithoutCloudSupport,
	{
		rules: {
			'n8n-nodes-base/node-param-display-name-miscased': 'off',
		},
	},
];
