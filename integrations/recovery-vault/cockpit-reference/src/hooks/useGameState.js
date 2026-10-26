import { useState, useCallback } from 'react';

const useGameState = () => {
  const [xp, setXp] = useState(0);
  const [shrineBlessings, setShrineBlessings] = useState([]);
  const handleShrineBlessing = useCallback((shrineNumber, xpGained) => {
    setXp(prev => prev + xpGained);
    setShrineBlessings(prev => [...prev, { shrine: shrineNumber, timestamp: Date.now(), xp: xpGained }]);
  }, []);
  const resetGame = useCallback(() => {
    setXp(0); setShrineBlessings([]);
    if (window.game) window.game.scene.restart();
  }, []);
  const getMostVisitedShrine = () => {
    if (shrineBlessings.length === 0) return null;
    const counts = shrineBlessings.reduce((acc, item) => { acc[item.shrine] = (acc[item.shrine] || 0) + 1; return acc; }, {});
    return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
  };
  const getStats = useCallback(() => ({ totalXP: xp, shrinesVisited: shrineBlessings.length, averageXPPerShrine: shrineBlessings.length > 0 ? (xp / shrineBlessings.length).toFixed(1) : 0, mostVisitedShrine: getMostVisitedShrine() }), [xp, shrineBlessings]);
  return { xp, shrineBlessings, handleShrineBlessing, resetGame, getStats };
};
export default useGameState;
