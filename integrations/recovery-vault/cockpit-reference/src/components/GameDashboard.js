import React from 'react';
import ProfileManager from './ProfileManager';
import StatsPanel from './StatsPanel';
import GameContainer from './GameContainer';
import BlessingsLog from './BlessingsLog';
import ResetButton from './ResetButton';

const GameDashboard = ({ xp, shrineBlessings, gameActive, onResetGame, onShrineBlessing, stats }) => <div className="App">
  <header className="App-header"><div className="header-top"><h1>DIA P2E Cockpit</h1><ProfileManager /></div>
    <StatsPanel xp={xp} shrineBlessings={shrineBlessings} gameActive={gameActive} stats={stats} />
    <ResetButton onReset={onResetGame} />
  </header>
  <main className="game-container"><GameContainer onShrineBlessing={onShrineBlessing} /></main>
  <aside className="blessings-log"><BlessingsLog shrineBlessings={shrineBlessings} /></aside>
</div>;
export default GameDashboard;
