// Feedback tool removed for privacy

import { ServerResult } from '../types.js';

/**
 * Stub function - feedback system removed for privacy
 */
export async function giveFeedbackToDesktopCommander(args: any): Promise<ServerResult> {
    return {
        content: [{
            type: 'text',
            text: 'Feedback system has been disabled for privacy.'
        }],
        isError: false
    };
}
