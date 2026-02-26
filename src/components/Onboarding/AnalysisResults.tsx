/**
 * Analysis Results
 * Displays the channel analysis insights
 */

import type { ChannelAnalysisData } from '../../types/electron';

interface AnalysisResultsProps {
  data: ChannelAnalysisData;
  onComplete: () => void;
}

export function AnalysisResults({ data, onComplete }: AnalysisResultsProps) {
  const { channel, analysis } = data;

  return (
    <div className="analysis-results max-h-[80vh] flex flex-col">
      {/* Success Header */}
      <div className="text-center mb-6 flex-shrink-0">
        <div className="inline-block p-3 bg-green-500/20 rounded-full mb-4">
          <svg className="w-12 h-12 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">
          Analysis Complete!
        </h2>
        <p className="text-gray-400">
          Here's what we learned about your channel
        </p>
      </div>

      {/* Channel Overview */}
      <div className="bg-gray-700/50 rounded-lg p-4 mb-6 flex items-center gap-4 flex-shrink-0">
        {channel.thumbnail_url && (
          <img 
            src={channel.thumbnail_url} 
            alt={channel.title}
            className="w-16 h-16 rounded-full"
          />
        )}
        <div className="flex-1">
          <h3 className="text-lg font-bold text-white">{channel.title}</h3>
          <div className="flex gap-4 text-sm text-gray-400 mt-1">
            <span>{channel.subscriber_count.toLocaleString()} subscribers</span>
            <span>•</span>
            <span>{channel.video_count} videos</span>
          </div>
        </div>
      </div>

      {/* Scrollable Results */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 min-h-0">
        {/* Channel Summary */}
        <div className="bg-gray-700/50 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
            <span>📊</span> Channel Overview
          </h3>
          <p className="text-gray-300 text-sm leading-relaxed">
            {analysis.channel_summary}
          </p>
        </div>

        {/* Strengths */}
        <div className="bg-gray-700/50 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <span>💪</span> Content Strengths
          </h3>
          <ul className="space-y-2">
            {analysis.content_strengths.map((strength, idx) => (
              <li key={idx} className="text-gray-300 text-sm flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>{strength}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Editing Recommendations */}
        <div className="bg-gray-700/50 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <span>✂️</span> Editing Style Tips
          </h3>
          <ul className="space-y-2">
            {analysis.editing_style_recommendations.map((tip, idx) => (
              <li key={idx} className="text-gray-300 text-sm flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">→</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Growth Suggestions */}
        <div className="bg-gray-700/50 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <span>📈</span> Growth Opportunities
          </h3>
          <ul className="space-y-2">
            {analysis.growth_suggestions.map((suggestion, idx) => (
              <li key={idx} className="text-gray-300 text-sm flex items-start gap-2">
                <span className="text-purple-500 mt-0.5">★</span>
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Audience Insights */}
        <div className="bg-gray-700/50 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <span>👥</span> Audience Insights
          </h3>
          <ul className="space-y-2">
            {analysis.audience_insights.map((insight, idx) => (
              <li key={idx} className="text-gray-300 text-sm flex items-start gap-2">
                <span className="text-yellow-500 mt-0.5">◆</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Areas for Improvement */}
        {analysis.weaknesses.length > 0 && (
          <div className="bg-gray-700/50 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <span>🎯</span> Areas to Focus On
            </h3>
            <ul className="space-y-2">
              {analysis.weaknesses.map((weakness, idx) => (
                <li key={idx} className="text-gray-300 text-sm flex items-start gap-2">
                  <span className="text-orange-500 mt-0.5">!</span>
                  <span>{weakness}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Action Button */}
      <div className="pt-4 mt-4 border-t border-gray-700 flex-shrink-0">
        <button
          onClick={onComplete}
          className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          Start Editing
        </button>
        <p className="text-xs text-gray-500 text-center mt-3">
          You can access these insights anytime in AI chat
        </p>
      </div>
    </div>
  );
}
