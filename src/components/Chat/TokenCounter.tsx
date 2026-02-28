import React from 'react';
import { useChatStore } from '../../stores/useChatStore';
import { getStats } from '../../lib/rateLimiter';

export const TokenCounter: React.FC = () => {
    const getSessionStats = useChatStore((state) => state.getSessionStats);
    const stats = getSessionStats();
    const rateStats = getStats();

    // Format large numbers with K/M suffix
    const formatTokens = (tokens: number): string => {
        if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
        if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
        return tokens.toString();
    };

    const formatCost = (cost: number): string => `$${cost.toFixed(4)}`;

    // Context window usage (Nova Lite supports large windows; keep a conservative UI meter)
    const contextUsagePercent = (stats.totalTokens / 1_000_000) * 100;

    // Color for context window
    const getContextColor = () => {
        if (contextUsagePercent >= 90) return 'text-red-400';
        if (contextUsagePercent >= 70) return 'text-yellow-400';
        return 'text-green-400';
    };

    // Color for RPM (yellow >80%, red >93%)
    const getRpmColor = () => {
        if (rateStats.rpmUsedPercent >= 93) return 'text-red-400';
        if (rateStats.rpmUsedPercent >= 80) return 'text-yellow-400';
        return 'text-gray-400';
    };

    // Color for RPD (yellow >80%, red >93%)
    const getRpdColor = () => {
        if (rateStats.rpdUsedPercent >= 93) return 'text-red-400';
        if (rateStats.rpdUsedPercent >= 80) return 'text-yellow-400';
        return 'text-gray-400';
    };

    if (stats.totalTokens === 0 && rateStats.requestsToday === 0) {
        return null;
    }

    return (
        <div className="group relative">
            {/* Compact Display */}
            <div className={`flex items-center gap-2 text-sm ${getContextColor()} cursor-help`}>
                {stats.totalTokens > 0 && (
                    <span className="font-mono">T {formatTokens(stats.totalTokens)}</span>
                )}
                <span className={`text-xs font-mono ${getRpdColor()}`}>
                    {rateStats.requestsToday}/{rateStats.rpdLimit}
                </span>
                {rateStats.isThrottled && (
                    <span className="text-xs text-orange-400 animate-pulse">wait</span>
                )}
            </div>

            {/* Tooltip on Hover */}
            <div className="absolute right-0 top-full mt-2 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <div className="text-xs space-y-2">
                    <div className="font-semibold text-white border-b border-gray-700 pb-2">
                        Session Token Usage
                    </div>

                    {/* Token breakdown */}
                    {stats.totalTokens > 0 && (
                        <div className="space-y-1">
                            <div className="flex justify-between">
                                <span className="text-gray-400">Input:</span>
                                <span className="text-white font-mono">{stats.totalPromptTokens.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Output:</span>
                                <span className="text-white font-mono">{stats.totalResponseTokens.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between font-semibold pt-1 border-t border-gray-700">
                                <span className="text-gray-300">Total:</span>
                                <span className="text-white font-mono">{stats.totalTokens.toLocaleString()}</span>
                            </div>
                        </div>
                    )}

                    {/* Cost */}
                    {stats.totalTokens > 0 && (
                        <div className="pt-1 border-t border-gray-700 space-y-1">
                            <div className="flex justify-between">
                                <span className="text-gray-400">Est. Cost:</span>
                                <span className="text-green-400 font-mono">{formatCost(stats.estimatedCost)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Context:</span>
                                <span className={`font-mono ${getContextColor()}`}>{contextUsagePercent.toFixed(2)}%</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Messages:</span>
                                <span className="text-white font-mono">{stats.messageCount}</span>
                            </div>
                            {/* Context window bar */}
                            <div className="h-1 bg-gray-700 rounded-full overflow-hidden mt-1">
                                <div
                                    className={`h-full transition-all duration-300 ${contextUsagePercent >= 90 ? 'bg-red-500' : contextUsagePercent >= 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                    style={{ width: `${Math.min(contextUsagePercent, 100)}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Rate limit section */}
                    <div className="pt-1 border-t border-gray-700 space-y-1">
                        <div className="text-gray-300 font-semibold">Rate Limits</div>

                        {/* RPM */}
                        <div className="flex justify-between items-center">
                            <span className="text-gray-400">Per minute:</span>
                            <span className={`font-mono font-semibold ${getRpmColor()}`}>
                                {rateStats.requestsInLastMinute}/{rateStats.rpmLimit} RPM
                            </span>
                        </div>
                        <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                            <div
                                className={`h-full transition-all duration-300 ${rateStats.rpmUsedPercent >= 93 ? 'bg-red-500' : rateStats.rpmUsedPercent >= 80 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                                style={{ width: `${Math.min(rateStats.rpmUsedPercent, 100)}%` }}
                            />
                        </div>

                        {/* RPD */}
                        <div className="flex justify-between items-center">
                            <span className="text-gray-400">Today:</span>
                            <span className={`font-mono font-semibold ${getRpdColor()}`}>
                                {rateStats.requestsToday}/{rateStats.rpdLimit} RPD
                            </span>
                        </div>
                        <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                            <div
                                className={`h-full transition-all duration-300 ${rateStats.rpdUsedPercent >= 93 ? 'bg-red-500' : rateStats.rpdUsedPercent >= 80 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                                style={{ width: `${Math.min(rateStats.rpdUsedPercent, 100)}%` }}
                            />
                        </div>

                        {rateStats.isThrottled && (
                            <div className="text-orange-400 text-[10px]">
                                Rate limited, waiting {(rateStats.msUntilNextSlot / 1000).toFixed(1)}s
                            </div>
                        )}
                    </div>

                    <div className="text-[10px] text-gray-500 pt-1 border-t border-gray-700">
                        Model: amazon.nova-lite-v1:0
                        <div className="text-gray-600">Pricing: $0.06/1M input · $0.24/1M output</div>
                    </div>
                </div>
            </div>
        </div>
    );
};
