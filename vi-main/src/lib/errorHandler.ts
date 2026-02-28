/**
 * Enhanced Error Handling for AI API
 * 
 * Provides type-safe error handling with user-friendly messages
 * and proper retry logic for different error types.
 */

/**
 * Error information with user-friendly messages
 */
export interface ErrorInfo {
  message: string;           // Technical error message
  userMessage: string;       // User-friendly message
  retryable: boolean;        // Whether the error is retryable
  httpCode?: number;         // HTTP status code if available
  category?: string;         // Error category for logging
}

/**
 * Handle AI API errors and return structured error information
 */
export class AIErrorHandler {
  /**
   * Process an error and return structured error info
   */
  static handle(error: unknown): ErrorInfo {
    // Check if it's an error with a status property (API error)
    if (this.isApiError(error)) {
      return this.handleApiError(error);
    }
    
    // Handle standard Error objects
    if (error instanceof Error) {
      return this.handleStandardError(error);
    }
    
    // Handle unknown error types
    return {
      message: String(error),
      userMessage: 'An unexpected error occurred',
      retryable: false,
      category: 'unknown',
    };
  }
  
  /**
   * Type guard to check if error is an API error with status
   */
  private static isApiError(error: unknown): error is { status: number; message: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof (error as any).status === 'number'
    );
  }
  
  /**
   * Handle API errors based on HTTP status codes
   */
  private static handleApiError(error: { status: number; message: string }): ErrorInfo {
    const status = error.status;
    const message = error.message;
    
    switch (status) {
      case 400: // INVALID_ARGUMENT
        return {
          message,
          userMessage: 'Invalid request. The file format or parameters may not be supported.',
          retryable: false,
          httpCode: 400,
          category: 'invalid_argument',
        };
      
      case 403: // PERMISSION_DENIED
        return {
          message,
          userMessage: 'API key is invalid or expired. Please check your settings.',
          retryable: false,
          httpCode: 403,
          category: 'permission_denied',
        };
      
      case 404: // NOT_FOUND
        return {
          message,
          userMessage: 'The requested resource was not found.',
          retryable: false,
          httpCode: 404,
          category: 'not_found',
        };
      
      case 413: // PAYLOAD_TOO_LARGE
        return {
          message,
          userMessage: 'File is too large. Try a smaller file or use video clipping.',
          retryable: false,
          httpCode: 413,
          category: 'payload_too_large',
        };
      
      case 429: // RESOURCE_EXHAUSTED / RATE_LIMITED
        return {
          message,
          userMessage: 'Rate limit exceeded. Please wait a few minutes and try again.',
          retryable: true,
          httpCode: 429,
          category: 'rate_limit',
        };
      
      case 500: // INTERNAL
        return {
          message,
          userMessage: 'AI API encountered an internal error. Retrying...',
          retryable: true,
          httpCode: 500,
          category: 'internal_error',
        };
      
      case 503: // UNAVAILABLE
        return {
          message,
          userMessage: 'Service temporarily unavailable. Retrying...',
          retryable: true,
          httpCode: 503,
          category: 'service_unavailable',
        };
      
      case 504: // DEADLINE_EXCEEDED
        return {
          message,
          userMessage: 'Request timed out. The file may be too large. Try analyzing a shorter clip.',
          retryable: true,
          httpCode: 504,
          category: 'timeout',
        };
      
      default:
        return {
          message,
          userMessage: `API Error (${status}): ${message}`,
          retryable: status >= 500, // Server errors are retryable
          httpCode: status,
          category: 'api_error',
        };
    }
  }
  
  /**
   * Handle standard JavaScript Error objects
   */
  private static handleStandardError(error: Error): ErrorInfo {
    const message = error.message.toLowerCase();
    
    // Check for network errors
    if (message.includes('network') || message.includes('fetch')) {
      return {
        message: error.message,
        userMessage: 'Network error. Please check your internet connection.',
        retryable: true,
        category: 'network',
      };
    }
    
    // Check for timeout errors
    if (message.includes('timeout')) {
      return {
        message: error.message,
        userMessage: 'Request timed out. Please try again.',
        retryable: true,
        category: 'timeout',
      };
    }
    
    // Check for parsing errors
    if (message.includes('json') || message.includes('parse')) {
      return {
        message: error.message,
        userMessage: 'Failed to process the response. Please try again.',
        retryable: true,
        category: 'parsing',
      };
    }
    
    // Generic error
    return {
      message: error.message,
      userMessage: error.message,
      retryable: false,
      category: 'generic',
    };
  }
  
  /**
   * Check if an error string contains retryable indicators
   */
  static isRetryableErrorMessage(errorMessage: string): boolean {
    const retryablePatterns = [
      /500/,
      /503/,
      /504/,
      /timeout/i,
      /unavailable/i,
      /deadline/i,
      /network/i,
      /econnreset/i,
    ];
    
    return retryablePatterns.some(pattern => pattern.test(errorMessage));
  }
}

/**
 * Safety filter response checker
 */
export interface SafetyCheckResult {
  blocked: boolean;
  reason?: string;
  category?: string;
}

/**
 * Check if a response was blocked by safety filters
 */
export function checkResponseSafety(response: any): SafetyCheckResult {
  const candidate = response.candidates?.[0];
  
  if (!candidate) {
    return { blocked: true, reason: 'No candidates returned' };
  }
  
  const finishReason = candidate.finishReason;
  
  if (finishReason === 'SAFETY') {
    const safetyRatings = candidate.safetyRatings || [];
    const blocked = safetyRatings.find((r: any) => r.blocked);
    return {
      blocked: true,
      reason: 'Content was blocked by safety filters',
      category: blocked?.category,
    };
  }
  
  if (finishReason === 'RECITATION') {
    return {
      blocked: true,
      reason: 'Content may violate copyright (recitation detected)',
    };
  }
  
  if (finishReason === 'OTHER') {
    return {
      blocked: true,
      reason: 'Content may violate terms of service',
    };
  }
  
  return { blocked: false };
}

/**
 * Rate limit tracker to implement intelligent backoff
 */
export class RateLimitTracker {
  private lastRateLimit: number = 0;
  private backoffMultiplier: number = 1;
  
  /**
   * Call when a rate limit error occurs
   */
  onRateLimit(): void {
    this.lastRateLimit = Date.now();
    this.backoffMultiplier = Math.min(this.backoffMultiplier * 2, 16);
  }
  
  /**
   * Call when a request succeeds
   */
  onSuccess(): void {
    // Gradually reduce backoff on success
    this.backoffMultiplier = Math.max(this.backoffMultiplier * 0.5, 1);
  }
  
  /**
   * Get recommended wait time before next request
   */
  getWaitTime(): number {
    const timeSinceLastLimit = Date.now() - this.lastRateLimit;
    const baseWait = 60000; // 1 minute
    return Math.max(0, (baseWait * this.backoffMultiplier) - timeSinceLastLimit);
  }
  
  /**
   * Check if we should wait before making a request
   */
  shouldWait(): boolean {
    return this.getWaitTime() > 0;
  }
}
