/**
 * NodeGatePanel Component
 * UI panel for interacting with the AI-BI Intelligence Node-Gate
 * 
 * Copyright (c) 2025-2026 Damien Edward Featherstone / No-Gas-Labs™
 */

import { useState, useEffect } from "react";
import { useNodeGate, TAG_COLORS, PERSONA_COLORS } from "../hooks/useNodeGate";

export function NodeGatePanel() {
  const [input, setInput] = useState("");
  const { intervene, result, error, isLoading, isHealthy, checkHealth } = useNodeGate();

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      await intervene(input);
    }
  };

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">
          🚪 Intelligence Node-Gate
        </h2>
        <div className="flex items-center gap-2">
          <span
            className={`w-3 h-3 rounded-full ${
              isHealthy ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-sm text-gray-400">
            {isHealthy ? "OPERATIONAL" : "OFFLINE"}
          </span>
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="mb-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter signal for epistemic classification..."
          className="w-full h-24 bg-gray-800 text-white rounded-lg p-3 border border-gray-600 focus:border-cyan-500 focus:outline-none resize-none"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="mt-2 w-full bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition-colors"
        >
          {isLoading ? "Processing..." : "INTERVENE"}
        </button>
      </form>

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-red-400 font-bold">⚠️ BOB FACTOR DETECTED</span>
            <span className="text-sm text-red-300">
              Level: {(error.bob_factor_level * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-red-200 text-sm">{error.message}</p>
          <p className="text-red-300 text-xs mt-1">
            💡 {error.recommendation}
          </p>
        </div>
      )}

      {/* Result Display */}
      {result && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-4">
          {/* Classification Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className={`px-3 py-1 rounded-full text-white font-bold ${
                  TAG_COLORS[result.epistemic_tag]
                }`}
              >
                {result.epistemic_tag}
              </span>
              <span className="text-gray-300">{result.tag_name}</span>
            </div>
            <span className="text-sm text-gray-400">
              Confidence: {(result.confidence_score * 100).toFixed(0)}%
            </span>
          </div>

          {/* Persona */}
          <div className="flex items-center gap-2">
            <span className="text-gray-400">Dispatched to:</span>
            <span
              className={`font-bold ${
                PERSONA_COLORS[result.dispatched_persona]
              }`}
            >
              {result.dispatched_persona}
            </span>
          </div>

          {/* Reasoning */}
          <div className="text-sm text-gray-400">
            <span className="text-gray-500">Reasoning: </span>
            {result.classification_reasoning}
          </div>

          {/* Featherstonian Context */}
          <div className="border-t border-gray-700 pt-3">
            <div className="text-xs text-gray-500 mb-2">
              FEATHERSTONIAN CONTEXT
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-500">Narrative State: </span>
                <span className="text-cyan-400">
                  {result.featherstonian_context.narrative_state}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Myth Engine: </span>
                <span className="text-purple-400">
                  {result.featherstonian_context.myth_engine.mode}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Jurisdiction: </span>
                <span className="text-gray-300">
                  {result.featherstonian_context.jurisdiction}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Governor: </span>
                <span className="text-gray-300">
                  {result.featherstonian_context.governor}
                </span>
              </div>
            </div>
          </div>

          {/* Intervention ID */}
          <div className="text-xs text-gray-600 font-mono">
            ID: {result.intervention_id}
          </div>
        </div>
      )}

      {/* Taxonomy Legend */}
      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="text-xs text-gray-500 mb-2">CLAIM TAXONOMY</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(TAG_COLORS).map(([tag, color]) => (
            <span
              key={tag}
              className={`px-2 py-1 rounded text-xs text-white ${color}`}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
