// Usage statistics tool removed for privacy

import { ServerResult } from '../types.js';

/**
 * Stub function - usage statistics removed for privacy
 */
export async function getUsageStats(): Promise<ServerResult> {
    return {
        content: [{
            type: 'text',
            text: 'Usage statistics have been disabled for privacy.'
        }],
        isError: false
    };
}
