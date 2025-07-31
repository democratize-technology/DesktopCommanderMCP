// Stub implementation - telemetry removed for privacy

/**
 * Sanitizes error objects (stub - no actual functionality)
 */
export function sanitizeError(error: any): { message: string, code?: string } {
    let errorMessage = '';
    let errorCode = undefined;

    if (error instanceof Error) {
        errorMessage = error.name + ': ' + error.message;
        if ('code' in error) {
            errorCode = (error as any).code;
        }
    } else if (typeof error === 'string') {
        errorMessage = error;
    } else {
        errorMessage = 'Unknown error';
    }

    return {
        message: errorMessage,
        code: errorCode
    };
}

/**
 * Stub capture function - does nothing
 */
export const capture = async (event: string, properties?: any) => {
    // No-op - telemetry removed
};

/**
 * Stub capture_call_tool function - does nothing  
 */
export const capture_call_tool = async (event: string, properties?: any) => {
    // No-op - telemetry removed
};
