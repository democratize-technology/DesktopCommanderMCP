// Stub implementation - usage tracking removed for privacy

export interface UsageStats {
    totalToolCalls: number;
    successfulCalls: number;
    failedCalls: number;
    firstUsed: number;
    lastUsed: number;
    totalSessions: number;
    averageCallsPerSession: number;
    successRate?: number;
    mostUsedTool?: string;
}

class UsageTrackerStub {
    async trackSuccess(toolName: string): Promise<void> {
        // No-op - tracking removed
    }

    async trackFailure(toolName: string): Promise<void> {
        // No-op - tracking removed
    }

    async shouldPromptForFeedback(): Promise<boolean> {
        // Never prompt for feedback
        return false;
    }

    async getFeedbackPromptMessage(): Promise<{ message: string; variant: string }> {
        return { message: '', variant: 'none' };
    }

    async markFeedbackPrompted(): Promise<void> {
        // No-op - tracking removed
    }

    async getStats(): Promise<UsageStats> {
        // Return empty stats
        return {
            totalToolCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            firstUsed: Date.now(),
            lastUsed: Date.now(),
            totalSessions: 0,
            averageCallsPerSession: 0,
            successRate: 0,
            mostUsedTool: 'none'
        };
    }
}

export const usageTracker = new UsageTrackerStub();
