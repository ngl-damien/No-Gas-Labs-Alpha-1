/**
 * useNodeGate Hook
 * React hook for interacting with the AI-BI Intelligence Node-Gate
 * 
 * Copyright (c) 2025-2026 Damien Edward Featherstone / No-Gas-Labs™
 */

import { useState, useCallback } from "react";

export interface InterventionResult {
  original_signal: string;
  epistemic_tag: "V" | "P" | "S" | "M" | "A" | "UNCLASSIFIED";
  tag_name: string;
  confidence_score: number;
  dispatched_persona: "Prometheus" | "Courier" | "Bob" | "REJECTED";
  persona_role: string;
  classification_reasoning: string;
  intervention_id: string;
  featherstonian_context: {
    narrative_state: string;
    jurisdiction: string;
    governor: string;
    myth_engine: {
      mode: string;
      status: string;
    };
  };
}

export interface NodeGateError {
  error: string;
  code: string;
  message: string;
  bob_factor_level: number;
  recommendation: string;
}

export interface UseNodeGateReturn {
  intervene: (input: string) => Promise<InterventionResult | null>;
  result: InterventionResult | null;
  error: NodeGateError | null;
  isLoading: boolean;
  isHealthy: boolean;
  checkHealth: () => Promise<boolean>;
}

export function useNodeGate(): UseNodeGateReturn {
  const [result, setResult] = useState<InterventionResult | null>(null);
  const [error, setError] = useState<NodeGateError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHealthy, setIsHealthy] = useState(false);

  const intervene = useCallback(async (input: string): Promise<InterventionResult | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/node-gate/intervene", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data as NodeGateError);
        setResult(null);
        return null;
      }

      setResult(data as InterventionResult);
      return data as InterventionResult;
    } catch (err) {
      setError({
        error: "NETWORK_ERROR",
        code: "NETWORK_ERROR",
        message: "Failed to connect to Node-Gate",
        bob_factor_level: 1.0,
        recommendation: "Check network connection and try again",
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/node-gate/health");
      const data = await response.json();
      const healthy = data.status === "OPERATIONAL";
      setIsHealthy(healthy);
      return healthy;
    } catch {
      setIsHealthy(false);
      return false;
    }
  }, []);

  return {
    intervene,
    result,
    error,
    isLoading,
    isHealthy,
    checkHealth,
  };
}

// Tag color mapping for UI
export const TAG_COLORS: Record<string, string> = {
  V: "bg-green-500",
  P: "bg-blue-500",
  S: "bg-yellow-500",
  M: "bg-purple-500",
  A: "bg-orange-500",
  UNCLASSIFIED: "bg-gray-500",
};

// Persona color mapping for UI
export const PERSONA_COLORS: Record<string, string> = {
  Prometheus: "text-orange-400",
  Courier: "text-blue-400",
  Bob: "text-gray-400",
  REJECTED: "text-red-400",
};
